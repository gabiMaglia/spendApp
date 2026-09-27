import { checkSettlement } from '@/src/sync/settlementTrust';
import { checkRecord } from '@/src/sync/trustCheck';
import { TOLERANCIA_RELOJ_MS } from '@/src/store/relojDelMerge';
import { syncedNow } from '@/src/utils/syncedClock';
import type { CoreVerdict } from '@/src/sync/recordSign';
import type { RecordVerdict } from '@/src/sync/recordHealth';
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
 *
 * **Y el acuse que cierra tiene que verificar** (T-145, SEC-04). Hasta el
 * 2026-09-26 se tomaba por `userId === toUserId`, y quien declaraba el pago
 * escribía él mismo el acuse de la otra persona. Ahora un `confirm` sólo cuenta
 * si su firma cierra contra una clave conocida de quien cobra; un `reject` se
 * honra salvo firma falsa, porque ante la duda se yerra hacia la deuda viva.
 * Si este teléfono todavía no conoce la clave del acreedor, un `confirm` real
 * se ve `pendiente` hasta que el directorio conteste — por D1 cuenta igual en
 * el balance, así que no mueve un centavo; sólo la etiqueta espera.
 *
 * Verificar acá cuesta curva en el camino del render: 18 ms por acuse, una
 * sola vez por firma (`settlementTrust` cachea), y sólo para pagos que
 * requieren acuse. Es la excepción medida a «este derivador no toca cripto».
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
 *  - lo declaró **quien cobra** (D3) **y lo puede probar**: su núcleo
 *    verifica `valida` contra las claves de `toUserId`. Es su propia
 *    declaración de haber recibido la plata, y pedirle que se confirme a sí
 *    mismo no informa nada — SALVO que cualquiera pueda escribir esa
 *    declaración en su nombre (T-170 · D-3, verifier T-145 residual 1): el
 *    deudor crea el pago con `createdById = toUserId` y hasta acá quedaba
 *    `efectivo` sin acuse, y el `reject` real del acreedor se ignoraba
 *    porque `estadoDelSaldado` ni llegaba a mirarlo. Sin firma válida, el
 *    atajo no aplica y hace falta el acuse de siempre.
 *
 * **Tercera salida (T-182):** un pago derivado de un CIERRE FORZADO — salida
 * con absorción (`leave:...`, `applyLeave.ts`) o expulsión
 * (`expel:...`, `expulsarDelGrupo.ts`) — tampoco pide acuse. Ninguno de los
 * dos pasa por una ronda de aprobación de saldos: la salida ya juntó las
 * aprobaciones del `LeaveRequest` (otro circuito, `leaveRequest.ts`) y la
 * expulsión es una decisión unilateral del creador. Pedirle a la otra parte
 * que confirme dejaría la deuda `pendiente` para siempre en el caso más común
 * — esa otra parte es justo quien ya salió del grupo. Se reconoce por el
 * prefijo del id y por no traer firma (`derived: true`, T-041 · S6): son
 * exactamente las dos condiciones que ya identifican a esta clase en
 * `derivedRecords.ts`. No se exige más prueba a propósito — decisión del PO
 * 2026-09-27: sin modelo de miembro malicioso para este ticket.
 */
function esPagoDeCierreForzado(payment: Payment): boolean {
  return !payment.k && !payment.s
    && (payment.id.startsWith('leave:') || payment.id.startsWith('expel:'));
}

/**
 * T-186 (Task 1): el modo «con acuerdo» se sacó — ya no queda ningún grupo
 * `consensus`, así que ningún saldado pide acuse. La función se queda (no
 * cambiar su firma todavía: la limpian de un saque `settlementCore`/
 * `settlementConfirm`/etc. en el Task 2 de la extracción, junto con
 * `esPagoDeCierreForzado` y el resto de esta máquina) pero ya no evalúa nada.
 */
export function requiereConfirmacion(
  _payment: Payment, _group: Group | undefined,
  _ctx: Pick<ContextoDeAcuse, 'nucleoDe'> = contextoReal(),
): boolean {
  return false;
}

/** Lo que el derivador necesita del mundo: la hora, quién verifica un acuse y el núcleo. */
export type ContextoDeAcuse = {
  now: number;
  veredicto: (paymentId: string, c: SettlementConfirmation) => CoreVerdict;
  /** Veredicto del NÚCLEO del pago (D-3), no del acuse. `checkRecord('payment', p)` en producción. */
  nucleoDe: (p: Payment) => RecordVerdict;
};

/** El contexto de producción. Se construye por llamada: `now` no se cachea. */
export function contextoReal(): ContextoDeAcuse {
  return { now: syncedNow(), veredicto: checkSettlement, nucleoDe: p => checkRecord('payment', p) };
}

/**
 * ¿Esta fecha no puede haber ocurrido todavía? Mismo criterio que `enElFuturo`
 * de `voteCore.ts`, aplicado a un timestamp pelado en vez de a un voto: una
 * fecha no finita o posterior a `now + TOLERANCIA_RELOJ_MS` no es creíble.
 *
 * NOTA (T-145): T-144 introduce `envenenado()` en `src/store/relojDelMerge.ts`
 * con esta misma regla para el resto del merge. Ese archivo no existe todavía
 * en esta rama (T-144 corre en paralelo, sin mergear) — este ticket no puede
 * depender de un archivo que no está. Se implementa acá la MISMA regla, sin
 * importar nada de T-144. Cuando T-144 mergee, unificar en `relojDelMerge.ts`
 * es un refactor sin cambio de comportamiento (deuda anotada en el backlog).
 */
function envenenado(confirmedAt: number, now: number): boolean {
  return !Number.isFinite(confirmedAt) || confirmedAt > now + TOLERANCIA_RELOJ_MS;
}

/**
 * El último acuse **de quien cobra** que se puede tomar en serio. El de
 * cualquier otro se ignora: un tercero no puede dar por recibida una plata que
 * no recibió él.
 *
 * Se resuelve por `confirmedAt` y no por el orden del array, porque el array es
 * el resultado de una unión entre teléfonos y su orden no significa nada. A
 * igual `confirmedAt` gana el rechazo: es el estado que devuelve la deuda a la
 * vida, y ante un empate conviene equivocarse hacia la deuda viva y no hacia
 * una plata dada por recibida.
 *
 * Antes de comparar fechas se descarta lo que no puede contar (T-145):
 *  - un `confirmedAt` del futuro o que no es una fecha (el `9e15` que le
 *    ganaba a cualquier rechazo real);
 *  - un `confirm` cuya firma no cierra (`valida` o nada);
 *  - un `reject` cuya firma es FALSA (`invalida`); sin firma se honra.
 */
function acuseVigente(
  paymentId: string,
  confirmations: readonly SettlementConfirmation[] | undefined,
  toUserId: string,
  ctx: ContextoDeAcuse,
): SettlementConfirmation | undefined {
  let mejor: SettlementConfirmation | undefined;
  for (const c of confirmations ?? []) {
    if (c.userId !== toUserId) continue;
    if (envenenado(c.confirmedAt, ctx.now)) continue;

    const veredicto = ctx.veredicto(paymentId, c);
    if (c.action === 'confirm' && veredicto !== 'valida') continue;
    if (c.action === 'reject' && veredicto === 'invalida') continue;

    if (mejor === undefined) { mejor = c; continue; }
    if (c.confirmedAt > mejor.confirmedAt) { mejor = c; continue; }
    if (c.confirmedAt === mejor.confirmedAt && c.action === 'reject') mejor = c;
  }
  return mejor;
}

export function estadoDelSaldado(
  payment: Payment, group: Group | undefined, ctx: ContextoDeAcuse = contextoReal(),
): EstadoSaldado {
  if (!requiereConfirmacion(payment, group, ctx)) return 'efectivo';

  const acuse = acuseVigente(payment.id, payment.confirmations, payment.toUserId, ctx);
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
  payments: readonly Payment[], group: Group | undefined, ctx: ContextoDeAcuse = contextoReal(),
): Payment[] {
  if (!group) return [];
  return payments.filter(p =>
    p.groupId === group.id && estadoDelSaldado(p, group, ctx) !== 'rechazado',
  );
}

/** Los saldados esperando acuse. Es lo que la UI muestra como tercer estado. */
export function saldadosPendientes(
  payments: readonly Payment[], group: Group | undefined, ctx: ContextoDeAcuse = contextoReal(),
): Payment[] {
  if (!group) return [];
  return payments.filter(p =>
    p.groupId === group.id && !p.isDeleted && estadoDelSaldado(p, group, ctx) === 'pendiente',
  );
}
