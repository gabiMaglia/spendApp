/**
 * Trabajo de producto que corre tras publicar los pendientes (T-252).
 * Vive aparte del motor: `session.ts` lo registra (con `salirDelGrupo`, que el
 * motor no puede importar sin arrastrar `movimientosDerivados` al grafo del
 * cable) y los tests que mockean `relayEngine` no lo ven.
 */
let gancho: () => Promise<void> = async () => {};

export function registrarGanchoPostSync(fn: () => Promise<void>): void { gancho = fn; }

export async function ejecutarGanchoPostSync(): Promise<void> {
  try { await gancho(); } catch { /* nunca rompe el sync */ }
}
