import type { Group, Payment, SettlementConfirmation } from '@/src/types/models';

/**
 * **En qué estado está un saldado** (T-064).
 *
 * En un grupo `consensus`, declarar que pagaste ya no salda solo: quien cobra
 * tiene que acusar recibo. El pedido del PO fue literal —«debe confirmar que
 * recibió el dinero primero, y luego se efectiviza el saldado»— y las tres
 * decisiones que lo aterrizan están estampadas en `engram/plans/T-064.md`.
 *
 * **El estado no se guarda: se deriva.** Un `status` adentro del `Payment`
 * sería LWW y cualquier peer lo pisaría republicando el registro con
 * `updatedAt` mayor, sin tocar una firma. Es la forma exacta de T-053, donde el
 * modo de borrado del grupo viajaba así y cualquiera lo bajaba de `consensus` a
 * `open`. Lo que se guarda son los acuses, que son aportes de gente distinta y
 * por lo tanto se **unen** en el merge (`mergeLevels`), no se eligen.
 */

export type EstadoSaldado =
  /** Cuenta como saldo cerrado. */
  | 'efectivo'
  /** Declarado por quien paga, sin acuse todavía. Cuenta en el balance (D1). */
  | 'pendiente'
  /** Quien cobra dijo que no lo recibió. **No cuenta**: la deuda vuelve. */
  | 'rechazado';

/**
 * ¿Este pago necesita acuse?
 *
 * Dos salidas, y las dos son decisiones del PO, no atajos:
 *  - el grupo no es `consensus` (D0: el alcance es sólo ése);
 *  - lo declaró **quien cobra** (D3): ya es su propia declaración de haber
 *    recibido la plata, y pedirle que se confirme a sí mismo no informa nada.
 */
export function requiereConfirmacion(payment: Payment, group: Group | undefined): boolean {
  if (group?.deletionMode !== 'consensus') return false;
  return payment.createdById !== payment.toUserId;
}

/**
 * El último acuse **de quien cobra**. El de cualquier otro se ignora: un tercero
 * no puede dar por recibida una plata que no recibió él.
 *
 * Se resuelve por `confirmedAt` y no por el orden del array, porque el array es
 * el resultado de una unión entre teléfonos y su orden no significa nada. A
 * igual `confirmedAt` gana el rechazo: es el estado que devuelve la deuda a la
 * vida, y ante un empate conviene equivocarse hacia la deuda viva y no hacia
 * una plata dada por recibida.
 */
function acuseVigente(
  confirmations: readonly SettlementConfirmation[] | undefined,
  toUserId: string,
): SettlementConfirmation | undefined {
  let mejor: SettlementConfirmation | undefined;
  for (const c of confirmations ?? []) {
    if (c.userId !== toUserId) continue;
    if (mejor === undefined) { mejor = c; continue; }
    if (c.confirmedAt > mejor.confirmedAt) { mejor = c; continue; }
    if (c.confirmedAt === mejor.confirmedAt && c.action === 'reject') mejor = c;
  }
  return mejor;
}

export function estadoDelSaldado(payment: Payment, group: Group | undefined): EstadoSaldado {
  if (!requiereConfirmacion(payment, group)) return 'efectivo';

  const acuse = acuseVigente(payment.confirmations, payment.toUserId);
  if (!acuse) return 'pendiente';
  return acuse.action === 'confirm' ? 'efectivo' : 'rechazado';
}

/**
 * Los pagos de un grupo que **cuentan para el balance**.
 *
 * `efectivo` y `pendiente` cuentan igual: es la decisión D1 del PO —mientras
 * espera el acuse, la deuda no figura ni viva ni saldada, y quien ya transfirió
 * la plata no queda de deudor—. `rechazado` no cuenta: la deuda vuelve.
 *
 * **Existe como función única y no como un `.filter()` en cada pantalla.** Los
 * seis lugares que calculaban balances repetían `payments.filter(p => p.groupId
 * === g.id)` a mano, y esa forma —la misma lista mantenida en varios lados— es
 * la que produjo T-055, T-057 y T-060. `__tests__/settlementStatus.test.ts`
 * escanea el árbol para que no vuelva a aparecer suelta.
 */
export function pagosQueCuentan(
  payments: readonly Payment[], group: Group | undefined,
): Payment[] {
  if (!group) return [];
  return payments.filter(p =>
    p.groupId === group.id && estadoDelSaldado(p, group) !== 'rechazado',
  );
}

/** Los saldados esperando acuse. Es lo que la UI muestra como tercer estado. */
export function saldadosPendientes(
  payments: readonly Payment[], group: Group | undefined,
): Payment[] {
  if (!group) return [];
  return payments.filter(p =>
    p.groupId === group.id && !p.isDeleted && estadoDelSaldado(p, group) === 'pendiente',
  );
}
