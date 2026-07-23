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
