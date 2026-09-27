import type { SimpleStorage } from '@/src/utils/createStorage';
import { useAuthStore } from './authStore';

// Aislamiento de datos por cuenta: cada usuario logueado tiene su propio
// namespace de persistencia. Sin esto, dos cuentas en el mismo device
// compartirían balances/config. `tierStore` ya scopea por su cuenta; acá
// scopeamos los stores de datos y settings.

export function activeUserId(): string | null {
  return useAuthStore.getState().currentUser?.id ?? null;
}

function scopedKey(base: string, uid: string): string {
  return `${base}::u:${uid}`;
}
function legacyFlagKey(base: string): string {
  return `${base}::legacy_migrated_v1`;
}

// ── Escritor diferido (T-156) ────────────────────────────────────────────
//
// Agrupa escrituras seguidas a la misma clave en 1 sola escritura a MMKV, con
// serialización perezosa (el `JSON.stringify` corre una sola vez, al vaciar,
// no en cada acción del usuario). Motivación: una pantalla que dispara muchos
// `addExpense`/`updateGroup` seguidos (import, merge de sync) hacía un
// `storage.set` por cada uno, cada uno con su propio stringify del array
// entero — trabajo de más en el hilo de JS que nadie necesitaba ver.
//
// El uid se captura AL PROGRAMAR, no al vaciar (fila U3 de la tabla): si la
// cuenta activa cambia mientras la escritura está pendiente, lo pendiente
// sigue siendo de la cuenta que lo pidió, nunca de la que quedó activa.
//
// La clave del mapa incluye la identidad del `storage`: varios stores repiten
// el mismo `base` ('data_v1') pero en buckets MMKV distintos — sin esto, dos
// pendientes de stores distintos con el mismo `base` se pisarían entre sí.
export const SCOPED_WRITE_DELAY_MS = 300;

type Pendiente = {
  storage: SimpleStorage;
  key: string;
  serialize: () => string;
  timer: ReturnType<typeof setTimeout>;
};

const pendientesPorStorage = new Map<SimpleStorage, Map<string, Pendiente>>();

function mapaDe(storage: SimpleStorage): Map<string, Pendiente> {
  let m = pendientesPorStorage.get(storage);
  if (!m) { m = new Map(); pendientesPorStorage.set(storage, m); }
  return m;
}

function vaciar(storage: SimpleStorage, key: string): void {
  const mapa = pendientesPorStorage.get(storage);
  const p = mapa?.get(key);
  if (!p) return;
  clearTimeout(p.timer);
  mapa!.delete(key);
  p.storage.set(key, p.serialize());
}

/**
 * Programa una escritura scopeada al usuario activo, agrupando escrituras
 * seguidas a la misma clave. Sin usuario activo → no-op (fila U6).
 */
export function writeScopedLazy(storage: SimpleStorage, base: string, serialize: () => string): void {
  const uid = activeUserId();
  if (!uid) return;
  const key = scopedKey(base, uid); // uid capturado AHORA (fila U3)

  const mapa = mapaDe(storage);
  const previo = mapa.get(key);
  if (previo) clearTimeout(previo.timer);

  const timer = setTimeout(() => vaciar(storage, key), SCOPED_WRITE_DELAY_MS);
  // `unref` no existe en el timer de React Native (número, no `Timeout`) —
  // por eso opcional. En Jest/Node evita que un timer de 300ms colgado (un
  // test que no vació ni avanzó los fake timers) mantenga vivo el proceso.
  (timer as unknown as { unref?: () => void }).unref?.();
  mapa.set(key, { storage, key, serialize, timer });
}

/** Vacía YA toda escritura pendiente (todos los stores). Para el paso a background. */
export function flushScopedWrites(): void {
  for (const [storage, mapa] of pendientesPorStorage) {
    for (const key of [...mapa.keys()]) vaciar(storage, key);
  }
}

/** Cancela toda escritura pendiente SIN escribirla. Para un borrado/wipe. */
export function discardScopedWrites(): void {
  for (const mapa of pendientesPorStorage.values()) {
    for (const p of mapa.values()) clearTimeout(p.timer);
    mapa.clear();
  }
}

/**
 * Lee un valor string scopeado por el usuario activo. Si el usuario todavía no
 * guardó nada bajo su scope PERO existe data "legacy" sin scope (de antes del
 * aislamiento por cuenta), la migra UNA sola vez al primer usuario que hidrata
 * y borra la vieja compartida (para que otras cuentas no la vean). Sin usuario
 * activo (deslogueado) → undefined (los stores quedan vacíos).
 */
export function readScoped(storage: SimpleStorage, base: string): string | undefined {
  const uid = activeUserId();
  if (!uid) return undefined;
  const key = scopedKey(base, uid);

  // Fila U4: si hay una escritura diferida pendiente para ESTA clave, se
  // vacía antes de leer — quien lee tiene que ver el último valor, no el
  // que todavía está esperando el debounce.
  vaciar(storage, key);

  const scoped = storage.getString(key);
  if (scoped !== undefined) return scoped;

  const legacy = storage.getString(base);
  if (legacy !== undefined && storage.getBoolean(legacyFlagKey(base)) !== true) {
    storage.set(key, legacy);
    storage.set(legacyFlagKey(base), true);
    storage.delete(base);
    return legacy;
  }
  return undefined;
}

/** Escribe un valor string en el scope del usuario activo. Sin usuario → no-op. */
export function writeScoped(storage: SimpleStorage, base: string, value: string): void {
  const uid = activeUserId();
  if (!uid) return;
  storage.set(scopedKey(base, uid), value);
}

/** Lee un booleano scopeado, con default si no hay valor / no hay usuario. */
export function readScopedBool(storage: SimpleStorage, base: string, def: boolean): boolean {
  const uid = activeUserId();
  if (!uid) return def;
  return storage.getBoolean(scopedKey(base, uid)) ?? def;
}

/** Escribe un booleano en el scope del usuario activo. Sin usuario → no-op. */
export function writeScopedBool(storage: SimpleStorage, base: string, value: boolean): void {
  const uid = activeUserId();
  if (!uid) return;
  storage.set(scopedKey(base, uid), value);
}
