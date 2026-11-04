import * as SecureStore from 'expo-secure-store';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { activeUserId } from '@/src/store/userScope';
import { olvidarIdentidadDelAparato } from '@/src/store/identityStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { olvidarTodoElAlmacen } from '@/src/sync/adaptadores/hushsplit/almacen';
import { registerDeviceKey } from '@/src/sync/confianza/deviceKeys';
import { olvidarDesfaseDeReloj } from '@/src/utils/syncedClock';
import { forceClearPersistedSession } from './relaySessionStorage';
import { deviceId, reiniciarEstadoDeAparato } from '@/src/sync/motor/cursor';
import { marcarPendienteDeDrenaje } from '@/src/sync/motor/pendingDrain';

/**
 * **Aparato clonado o restaurado (T-250).**
 *
 * Desde T-248 la clave MMKV viaja en el respaldo de iCloud / Inicio rápido, así
 * que TODO el MMKV viaja. Pero parte de lo que hay ahí es del APARATO, no de la
 * cuenta: `device_id`, la identidad (firma), la envoltura, la prenda del buzón,
 * los cursores y el ledger de cubos publicados / rebanadas aplicadas. Un iPad
 * restaurado del respaldo del iPhone —o un iPhone nuevo por Inicio rápido con el
 * viejo todavía vivo— quedaba con el MISMO remitente: cada uno excluye al otro al
 * releer (mismo `device_id`), la compactación por huella-del-dueño+`ckey` borra los
 * cubos del otro, y con el ledger clonado ninguno republica lo que cree ya
 * publicado. Un respaldo viejo en un teléfono nuevo pierde lo que el viejo
 * publicó después, y su primera publicación lo compacta.
 *
 * **Centinela.** Un ítem del llavero con `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`
 * guarda el `device_id` vigente. «THIS_DEVICE_ONLY» es lo que importa: el
 * llavero NO viaja al aparato nuevo aunque los archivos sí, así que el
 * centinela falta (o es de otro) justamente en un clon. Se eligió
 * AFTER_FIRST_UNLOCK y no WHEN_UNLOCKED porque el arranque puede ocurrir con el
 * teléfono bloqueado (lanzamiento en segundo plano): con WHEN_UNLOCKED la
 * lectura tiraría seguido y habría más arranques «indeterminados».
 *
 * **«Faltante» sólo cuenta como clon si ya hubo uno.** Junto al `device_id`
 * viaja en MMKV una marca (`device_sentinel_v1` = id que tenía el centinela).
 * El que ACTUALIZA desde 1.0.x tiene datos pero ninguna marca: su primer
 * arranque con este código escribe centinela y marca SIN regenerar nada. La
 * marca se escribe recién cuando el llavero aceptó el centinela.
 *
 * Tabla de estados (leer llavero → comparar):
 *  - llavero TIRA (bloqueado, error)       → `indeterminado`: no se hace nada,
 *    se reintenta el próximo arranque. Sólo `null` limpio significa «ausente».
 *  - sin datos de aparato en MMKV          → `instalacion_nueva`: centinela + marca.
 *    (incluye reinstalar en el mismo aparato: el llavero de iOS sobrevive a
 *    borrar la app pero el MMKV no; se pisa el centinela viejo.)
 *  - datos, sin marca                      → `actualizacion`: centinela + marca.
 *  - marca y centinela == marca            → `normal`.
 *  - marca y centinela ausente o distinto  → `restaurado`: se regenera.
 *
 * **Qué se regenera** (todo es del aparato): `device_id`, identidad Ed25519,
 * par de envoltura X25519, prenda del buzón (→ otra huella de dueño, así la
 * compactación de uno no toca los cubos del otro), todos los cursores, y el
 * ledger de cubos / rebanadas aplicadas de TODAS las cuentas. Además, por cuenta
 * (`aplicarReinicioPendienteDeCuenta`, cuando esa cuenta hidrata): cada grupo
 * se marca pendiente de drenaje —no se publica antes de releer, T-089— y se
 * registra la clave nueva en el directorio. Con cursor y ledger vacíos, el
 * drenaje relee todo y la publicación reenvía el estado completo (regla #8).
 * También se descartan el desfase de reloj (`clock_offset_v1`, es del aparato)
 * y la sesión del buzón (`sbauth`): el clon compartiría el refresh token con el
 * original (rotarlo en uno invalida al otro). Es lo menos disruptivo que
 * funciona: sin sesión, el arranque cae en el chequeo que ya existe
 * (`haySesionAnonimaValida` → `/auth/verify`, el mismo camino de quien entra
 * por primera vez): el invitado abre una sesión anónima propia (con app_id,
 * T-238) y Google/Apple reconectan desde esa pantalla, sin tocar `currentUser`
 * ni los datos. Costo: una pantalla de verificación (y captcha si el buzón lo
 * pide) en el primer arranque del clon. Sólo se limpia en el camino de clon,
 * nunca en actualización ni arranque normal.
 *
 * No se usa `marcarConTopic`: ese deriva el topic para olvidar cursor y ledger
 * de UN grupo, y acá ya se vaciaron TODOS; marcar es síncrono y no corre contra
 * `startRelay`.
 *
 * **Qué se conserva:** los datos de usuario (grupos, gastos, pagos…), las
 * claves de grupo, el secreto del canal de contactos y las invitaciones.
 * La tarjeta de contacto cambia de huella (lleva las públicas nuevas), así que
 * `anunciarMiTarjeta` la reenvía sola a los contactos.
 *
 * **Costos conocidos:** (1) los sobres que el aparato original publicó con la
 * prenda vieja no se pueden purgar desde el clon (sólo expiran por TTL);
 * (2) un reclamo de invitación en vuelo, respondido a la envoltura vieja, sólo
 * lo abre el original; (3) si el llavero deja leer pero no escribir, el
 * aparato se regenera en cada arranque hasta que escriba (re-sincroniza, no
 * pierde datos).
 */

const storage = createSecureStorage('groupkeys');
const CENTINELA_LLAVERO = 'hushsplit_device_sentinel_v1';
const MARCA = 'device_sentinel_v1';
const GEN = 'device_reset_gen';
const APLICADO = 'device_reset_aplicado'; // uid → gen con el registro de clave hecho
const MARCADO = 'device_reset_marcado'; // uid → gen con los grupos ya marcados

export type EstadoAparato =
  | 'instalacion_nueva' | 'actualizacion' | 'normal' | 'restaurado' | 'indeterminado';

const OPCIONES: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

function tieneDatosDeAparato(): boolean {
  return storage.contains('device_id') || storage.contains('identity_v1')
    || storage.contains('owner_secret_v1') || storage.contains('wrapkeys_v1');
}

async function escribirCentinela(id: string): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(CENTINELA_LLAVERO, id, OPCIONES);
    storage.set(MARCA, id);
    return true;
  } catch {
    return false;
  }
}

/** Llamar después de `bootstrapSecureStorage` y antes de hidratar / arrancar el relay. Nunca tira. */
export async function verificarAparato(): Promise<EstadoAparato> {
  let centinela: string | null;
  try {
    centinela = await SecureStore.getItemAsync(CENTINELA_LLAVERO, OPCIONES);
  } catch {
    return 'indeterminado';
  }

  try {
    const marca = storage.getString(MARCA);
    if (!tieneDatosDeAparato()) {
      return (await escribirCentinela(deviceId())) ? 'instalacion_nueva' : 'indeterminado';
    }
    if (marca === undefined) {
      return (await escribirCentinela(deviceId())) ? 'actualizacion' : 'indeterminado';
    }
    if (centinela === marca) return 'normal';

    // Clon / restauración: todo lo del aparato se descarta.
    const nuevoId = reiniciarEstadoDeAparato();
    olvidarIdentidadDelAparato();
    olvidarTodoElAlmacen();
    olvidarDesfaseDeReloj();
    forceClearPersistedSession();
    storage.set(GEN, `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
    await escribirCentinela(nuevoId);
    return 'restaurado';
  } catch {
    return 'indeterminado';
  }
}

function leerMapa(clave: string): Record<string, string> {
  try {
    const v = JSON.parse(storage.getString(clave) ?? '{}');
    return v && typeof v === 'object' ? v as Record<string, string> : {};
  } catch {
    return {};
  }
}

function anotar(clave: string, uid: string, gen: string): void {
  storage.set(clave, JSON.stringify({ ...leerMapa(clave), [uid]: gen }));
}

/**
 * Parte POR CUENTA del reinicio: los grupos y las claves son de la cuenta, así
 * que sólo se pueden marcar cuando esa cuenta hidrata. Va ANTES de `startRelay`.
 *
 * Dos pasos con registro propio: marcar grupos (una sola vez por cuenta y
 * regeneración) y registrar la clave en el directorio. Éste sólo se da por
 * hecho si el directorio contestó ok; sin sesión o sin red se reintenta en la
 * próxima rehidratación, y como los grupos ya están marcados no vuelve a
 * frenar publicaciones sin necesidad. Nunca tira.
 */
export async function aplicarReinicioPendienteDeCuenta(): Promise<void> {
  const gen = storage.getString(GEN);
  const uid = activeUserId();
  if (!gen || !uid) return;

  if (leerMapa(MARCADO)[uid] !== gen) {
    for (const k of useGroupKeyStore.getState().keys) marcarPendienteDeDrenaje(k.groupId);
    anotar(MARCADO, uid, gen);
  }

  if (leerMapa(APLICADO)[uid] === gen) return;
  try {
    const r = await registerDeviceKey();
    if (r.ok) anotar(APLICADO, uid, gen);
  } catch {
    // Se reintenta en la próxima rehidratación.
  }
}
