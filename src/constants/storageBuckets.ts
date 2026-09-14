/**
 * **Listas de buckets en claro** (fuente única).
 *
 * Viven acá y no en `src/store/wipeDevice.ts` porque las usa también
 * `src/utils/secureStorage.ts` en el arranque en limpio de T-124 L-E, y
 * `wipeDevice` importa `authStore`, que importa `secureStorage`: importarlas
 * desde `wipeDevice` armaba un ciclo. Duplicarlas tampoco: una lista copiada es
 * el bug de T-055, T-057 y T-060.
 */

/** Preferencias del dispositivo, no de una cuenta: nunca se borran. */
export const DEVICE_PREFS = ['theme', 'lang'] as const;

/** Storages en claro que sí son por cuenta. */
export const SCOPED_PLAIN = ['settings', 'tier'] as const;
