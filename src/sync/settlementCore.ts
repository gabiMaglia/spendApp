import { canonical } from '@/src/store/lww';
import type { SettlementConfirmation } from '@/src/types/models';

/**
 * **El enunciado de un acuse de recibo, y cómo se lee** (T-064).
 *
 * Mismo criterio que `voteCore.ts`: se firma **cada acuse por separado**, nunca
 * el array. Los acuses son una unión de aportes y una firma sobre un conjunto
 * que crece se invalida cada vez que crece.
 *
 * **Este archivo no toca criptografía a propósito.** Lo importa el derivador de
 * estado, que corre en cada render de balance; un `@noble` acá se pagaría 18 ms
 * por acuse en el camino más caliente de la app (D9 de T-041, remedido en el
 * device del PO el 2026-09-01). Firmar y verificar viven en `settlementSign.ts`.
 */

/**
 * Versión del algoritmo del enunciado. Congela qué campos entran y cómo se
 * serializan. Mismo criterio que `CORE_VERSION` y `VOTE_VERSION`.
 */
export const SETTLEMENT_VERSION = 1;

/**
 * El mensaje exacto que firma quien acusa recibo y verifica quien lee.
 *
 * Lleva `paymentId` —que no está en el acuse— porque sin él un "sí, lo recibí"
 * valdría para **cualquier** pago del grupo: alguien lo copia de un saldado de
 * mil pesos a uno de cien mil y la firma sigue cerrando. Es la misma razón por
 * la que `voteStatement` lleva su `expenseId`.
 *
 * Y lleva `t: 'settlement'` para que este enunciado no pueda leerse como el
 * núcleo de otra cosa ni como un voto de borrado.
 */
export function settlementStatement(
  paymentId: string, c: SettlementConfirmation,
): Record<string, unknown> {
  return {
    v: SETTLEMENT_VERSION,
    t: 'settlement',
    paymentId,
    userId:      c.userId,
    confirmedAt: c.confirmedAt,
    action:      c.action,
  };
}

export function canonicalSettlement(paymentId: string, c: SettlementConfirmation): string {
  return canonical(settlementStatement(paymentId, c));
}
