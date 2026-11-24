/**
 * El nativo se carga PEREZOSAMENTE, igual que en `avatar.ts:16-27`.
 *
 * Importarlo en el tope lo metía en el camino del sync: `groupStore` →
 * `relayEngine` → acá. Como todos los stores cuelgan de esa cadena, un build sin
 * el binario no perdía las notificaciones, no abría la app — que es exactamente
 * lo que pasó el 30/08 con `expo-image-manipulator`. Cargarlo recién al usarlo
 * hace que la ausencia DEGRADE en vez de romper.
 */
let modCache: typeof import('expo-notifications') | null | undefined;

export function cargarNotificaciones(): typeof import('expo-notifications') | null {
  // Memoizado: en un build sin el módulo, cada intento imprime un error rojo en
  // dev, y esto se llama una vez por aviso entregado.
  if (modCache !== undefined) return modCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    modCache = require('expo-notifications');
  } catch {
    modCache = null;
  }
  return modCache ?? null;
}
