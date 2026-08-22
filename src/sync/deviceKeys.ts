import { getRelayClient } from './relay';
import { ensureIdentity } from '@/src/store/identityStore';
import { useAuthStore } from '@/src/store/authStore';

/**
 * Directorio de claves públicas por cuenta (ADR-004).
 *
 * Resuelve el problema de fondo: hasta acá la identidad que firma era del
 * APARATO, así que un segundo teléfono, una reinstalación o restaurar un backup
 * producían una identidad nueva, indistinguible de la de un impostor.
 *
 * Cada dispositivo registra **su propia** clave pública bajo la cuenta de quien
 * está logueado. La clave privada NO se mueve nunca: no hay secretos que
 * sincronizar ni contraseña que pedirle al usuario.
 *
 * Lo que impide que alguien registre una clave bajo una cuenta ajena es la RLS
 * del servidor (`supabase/003_device_keys.sql`), no este archivo. Acá no hay
 * nada que proteger: sólo se publica una clave que es pública por definición.
 *
 * **Fase A**: se registra, no se verifica. Encender la verificación antes de que
 * todos los dispositivos hayan registrado rechazaría a todo el mundo.
 */

const TABLE = 'device_keys';

export type RegisterResult =
  | { ok: true; alreadyThere: boolean }
  | { ok: false; reason: 'not_configured' | 'no_session' | 'no_account' | 'denied' | 'network'; detail?: string };

/**
 * Registra la clave de ESTE dispositivo bajo la cuenta activa.
 *
 * Idempotente: la clave primaria es `(account_id, public_key)`, así que llamarla
 * de más no duplica ni falla.
 *
 * No puede tirar ni bloquear nada: si el directorio no está configurado, o el
 * login contra Supabase falla, la app tiene que seguir funcionando igual que
 * antes de que esto existiera.
 */
export async function registerDeviceKey(): Promise<RegisterResult> {
  const supabase = getRelayClient();
  if (!supabase) return { ok: false, reason: 'not_configured' };

  const accountId = useAuthStore.getState().currentUser?.id;
  if (!accountId) return { ok: false, reason: 'no_account' };

  try {
    const { data: sesion } = await supabase.auth.getSession();
    if (!sesion.session) return { ok: false, reason: 'no_session' };

    const { error } = await supabase
      .from(TABLE)
      .upsert(
        { account_id: accountId, public_key: ensureIdentity().publicKey },
        { onConflict: 'account_id,public_key', ignoreDuplicates: true },
      );

    if (error) {
      // Un rechazo de la RLS NO es un error de red: significa que esta sesión no
      // puede probar que la cuenta es suya (el borde de mails distintos del
      // ADR). Se distingue para poder decirlo en el diagnóstico en vez de
      // mostrar "sin conexión" y mandar a nadie a revisar el wifi.
      const denegado = error.code === '42501' || /row-level security/i.test(error.message);
      return { ok: false, reason: denegado ? 'denied' : 'network', detail: error.message };
    }

    return { ok: true, alreadyThere: false };
  } catch (e) {
    return { ok: false, reason: 'network', detail: String(e) };
  }
}

/**
 * Claves registradas de una cuenta. Vacío si no hay ninguna o si no se pudo
 * consultar — quien llame no puede distinguir "no tiene" de "no pude
 * preguntar", y por eso la Fase B tiene que tratar el vacío como "no verificar"
 * y nunca como "rechazar".
 */
export async function fetchAccountKeys(accountId: string): Promise<string[]> {
  const supabase = getRelayClient();
  if (!supabase || !accountId) return [];

  const filas = (data: unknown): string[] =>
    ((data ?? []) as { public_key: string }[]).map(r => r.public_key);

  try {
    // `account_keys` resuelve por PERSONA, no por proveedor: trae también los
    // dispositivos que esa misma persona registró entrando por otro proveedor
    // (ver supabase/005_claves_por_owner.sql). Es lo que evita que la fase B
    // rechace el segundo teléfono de alguien legítimo.
    const { data, error } = await supabase.rpc('account_keys', { p_account_id: accountId });
    if (!error) return filas(data);

    // La función todavía no existe en este proyecto: la migración 005 se corre
    // a mano y un cliente actualizado puede llegar antes. Se cae a la consulta
    // vieja —correcta, sólo más angosta— en vez de quedarse sin ninguna clave,
    // que en fase B se leería como "este sobre no verifica".
  } catch {
    // La red se reintenta abajo; si también falla, vacío.
  }

  try {
    // Con error, Supabase devuelve `data: null`, así que el `?? []` ya cubre
    // los dos casos. Un `if (error) return []` aparte sería una línea que
    // ningún test puede distinguir de su ausencia.
    const { data } = await supabase
      .from(TABLE)
      .select('public_key')
      .eq('account_id', accountId);

    return filas(data);
  } catch {
    return [];
  }
}
