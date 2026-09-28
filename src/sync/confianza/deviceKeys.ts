import { esFuncionAusente, getRelayClient } from '@/src/sync/adaptadores/supabase/relay';
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
  // T-147-b (Task 2): la escritura sale por el mismo cliente que la lectura
  // (`queryAccountKeys`, abajo) — el del BUZÓN. Ya no hay un cliente del
  // directorio aparte: para una cuenta, la sesión que dejó `signInWithIdToken`
  // en el login (`directoryAuth.ts`) vive PERSISTIDA acá.
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
  return (await queryAccountKeys(accountId)).keys;
}

/**
 * Igual que `fetchAccountKeys` pero distinguiendo **"no tiene ninguna"** de
 * **"no pude preguntar"**.
 *
 * `fetchAccountKeys` colapsa los dos casos en `[]` a propósito, porque para
 * verificar una firma dan lo mismo: sin claves no se verifica y punto. Pero
 * para saber si MI clave falta la diferencia lo es todo — un corte de red no
 * puede leerse como "tu clave no está registrada" y mandar al usuario a
 * reloguearse al pedo.
 */
export type KeysQuery = { ok: boolean; keys: string[] };

/**
 * Las LECTURAS del directorio salen por el cliente del BUZÓN (`getRelayClient`)
 * — **T-147-b (Task 2):** desde que se unificaron los clientes, esto ya es
 * el MISMO cliente que usa `registerDeviceKey` (arriba) para escribir — no
 * queda ninguna razón por la que las dos operaciones tuvieran que salir por
 * clientes distintos.
 *
 * **Obs 3 (verifier, ronda 2) — precisión sobre "pública", citando el SQL
 * real:** ANTES de 011a, `device_keys_read` es `for select using (true)`
 * (`supabase/003_device_keys.sql:51-53`, sin `to`: rol PUBLIC) y
 * `account_keys(text)` está `grant`eada a `anon, authenticated`
 * (`supabase/005_claves_por_owner.sql:50`) — ahí sí, cualquiera con la anon
 * key pelada, sin sesión de ningún tipo. **011b (el corte) cierra las dos:**
 * `drop policy device_keys_read` + `revoke select ... from anon`
 * (`supabase/011b_relay_rls_corte.sql:69,83`) y
 * `revoke execute ... account_keys(text) ... from public, anon` +
 * `grant ... to authenticated` (`:86-96`). Post-011b, leer el directorio SÍ
 * exige una sesión — cualquier sesión firmada (anónima o de cuenta le basta,
 * Supabase les da el rol Postgres `authenticated` por igual), nunca la anon
 * key sola. La lectura sigue funcionando igual en la práctica porque
 * `getRelayClient()` es el cliente PERSISTIDO — para cuando esto se llama
 * casi siempre ya tiene alguna sesión (`relayEngine.ts` la garantiza antes
 * de sincronizar) — pero un llamado que corriera ANTES de la primera
 * `ensureRelaySession()` (sin sesión todavía) fallaría con 42501 en un
 * servidor con 011b corrida. No se agregó una espera explícita acá: es el
 * mismo comportamiento "no pude preguntar → `desconocido`, nunca `falta`"
 * que ya maneja `verifyMyKeyRegistered` (abajo), y forzar una sesión primero
 * convertiría esta lectura, deliberadamente sin efectos secundarios, en una
 * que sí los tiene.
 */
export async function queryAccountKeys(accountId: string): Promise<KeysQuery> {
  const supabase = getRelayClient();
  if (!supabase || !accountId) return { ok: false, keys: [] };

  const filas = (data: unknown): string[] =>
    ((data ?? []) as { public_key: string }[]).map(r => r.public_key);

  try {
    // `account_keys` resuelve por PERSONA, no por proveedor: trae también los
    // dispositivos que esa misma persona registró entrando por otro proveedor
    // (ver supabase/005_claves_por_owner.sql). Es lo que evita que la fase B
    // rechace el segundo teléfono de alguien legítimo.
    const { data, error } = await supabase.rpc('account_keys', { p_account_id: accountId });
    if (!error) return { ok: true, keys: filas(data) };

    // La función todavía no existe en este proyecto: la migración 005 se corre
    // a mano y un cliente actualizado puede llegar antes. Se cae a la consulta
    // vieja —correcta, sólo más angosta— en vez de quedarse sin ninguna clave,
    // que en fase B se leería como "este sobre no verifica".
    //
    // T-147 (D6): **sólo** se cae al SELECT si la función está ausente. Tras
    // 011b esa consulta directa también está cerrada (`device_keys_read` se
    // borra) y devuelve vacío — un error de red que cayera acá lo confundiría
    // con "esta cuenta no tiene claves", que en fase B rechazaría a alguien
    // legítimo por un simple corte de señal.
    if (!esFuncionAusente(error)) return { ok: false, keys: [] };
  } catch {
    // El método ni siquiera existe (SDK viejo): es la misma situación que
    // "función ausente" —incompatibilidad de interfaz, no la red— así que cae
    // al SELECT de siempre en vez de rendirse.
  }

  try {
    // Con error, Supabase devuelve `data: null`, así que el `?? []` ya cubre
    // los dos casos. Un `if (error) return []` aparte sería una línea que
    // ningún test puede distinguir de su ausencia.
    const { data, error } = await supabase
      .from(TABLE)
      .select('public_key')
      .eq('account_id', accountId);

    return error ? { ok: false, keys: [] } : { ok: true, keys: filas(data) };
  } catch {
    return { ok: false, keys: [] };
  }
}

/**
 * ¿La clave de ESTE dispositivo está en el directorio?
 *
 *  - `registrada` — está. Nada que hacer.
 *  - `falta`      — el servidor contestó y NO está.
 *  - `desconocido`— no se pudo preguntar. **No es lo mismo que `falta`** y no
 *                   se le puede mostrar nada al usuario con esto.
 */
export type KeyPresence = 'registrada' | 'falta' | 'desconocido';

let presencia: KeyPresence = 'desconocido';

/** Último resultado conocido. Sin efectos: lo lee la UI. */
export function myKeyPresence(): KeyPresence {
  return presencia;
}

/**
 * Comprueba al arrancar si esta clave quedó registrada.
 *
 * Existe por un agujero real: `registerDeviceKey` se llama **sólo en el login**
 * (`app/auth/index.tsx`). Quien ya estuviera logueado cuando esto se publique
 * nunca se registra, no tiene ningún motivo para desloguearse, y no hay nada en
 * pantalla que se lo diga. Al encender el rechazo de la fase B, esa persona
 * dejaría de sincronizar sin entender por qué.
 *
 * Leer el directorio no depende de haber reconectado ya (Obs 3: post-011b
 * exige ALGUNA sesión firmada, pero no necesariamente la de cuenta — la
 * anónima de una instalación que todavía no reconectó también sirve, ver el
 * docblock de `queryAccountKeys`), así que esto se puede hacer en cada
 * arranque, incluso antes de que `verify.tsx` (T-147-b) termine de
 * reconectar la sesión de cuenta.
 *
 * Sólo DETECTA. Registrar necesita un `id_token` fresco, y pedirlo en silencio
 * al arrancar sería un login encubierto: la decisión de reloguearse es del
 * usuario, y para eso hay que avisarle.
 */
export async function verifyMyKeyRegistered(): Promise<KeyPresence> {
  const accountId = useAuthStore.getState().currentUser?.id;
  if (!accountId) {
    presencia = 'desconocido';
    return presencia;
  }

  const r = await queryAccountKeys(accountId);
  // Sin respuesta del servidor no se concluye nada. Tratar un corte de red como
  // "te falta la clave" mandaría al usuario a reloguearse sin necesidad.
  presencia = !r.ok
    ? 'desconocido'
    : r.keys.includes(ensureIdentity().publicKey) ? 'registrada' : 'falta';
  return presencia;
}
