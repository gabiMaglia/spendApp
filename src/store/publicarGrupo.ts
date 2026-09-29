/**
 * **Puente perezoso de las stores al motor de sync** (T-217).
 *
 * `groupStore`, `expenseStore`, `paymentStore` y `commentStore` programan la
 * publicación de un grupo después de cada cambio. Importar `relayEngine`
 * arriba del archivo cerraba un ciclo de carga (store → motor → invitaciones
 * / adaptador → store) que Metro avisaba al arrancar. Acá el motor se pide
 * con `require` DENTRO de la función: corre cuando una acción publica, nunca
 * al cargar la store, y ahí el motor ya está cargado.
 *
 * Mismo patrón que `pendingDrain.ts`/`ownerPledge.ts`. En tests, un
 * `jest.mock('@/src/sync/motor/relayEngine', …)` sigue interceptando esta
 * llamada: `require` devuelve el módulo mockeado.
 */
export function schedulePublish(groupId: string, delay?: number): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const motor = require('@/src/sync/motor/relayEngine') as typeof import('@/src/sync/motor/relayEngine');
  if (delay === undefined) motor.schedulePublish(groupId);
  else motor.schedulePublish(groupId, delay);
}
