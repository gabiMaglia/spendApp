import { canonical } from '@/src/store/lww';
import type { ApprovalEntry, LeaveApproval } from '@/src/types/models';

/**
 * **El enunciado de una aprobación de salida** (T-065).
 *
 * Mismo criterio que `voteCore` y `settlementCore`: se firma **cada aprobación
 * por separado**, nunca el conjunto. El conjunto se une entre teléfonos y una
 * firma sobre algo que crece se invalida cada vez que crece.
 *
 * **Este archivo no toca criptografía a propósito.** Lo importa
 * `leaveRequest.ts`, que lo usan pantallas y el arranque; firmar y verificar
 * viven en `leaveApprovalSign.ts` (D9 de T-041).
 */

export const LEAVE_APPROVAL_VERSION = 1;

/** Una entrada vieja —un id pelado— vista como aprobación sin firma. */
export function normalizarAprobacion(e: ApprovalEntry): LeaveApproval {
  return typeof e === 'string' ? { userId: e, approvedAt: 0 } : e;
}

export function normalizarAprobaciones(entries: readonly ApprovalEntry[]): LeaveApproval[] {
  return entries.map(normalizarAprobacion);
}

/**
 * El mensaje exacto que firma quien aprueba y verifica quien lee.
 *
 * Lleva **tres** datos que no están en la aprobación, y cada uno cierra una
 * puerta distinta:
 *
 *  - `groupId` — sin él, una aprobación se muda a otro grupo donde la misma
 *    persona también es miembro;
 *  - `leavingUserId` — sin él, aprobar que se vaya Beto vale como aprobar que
 *    se vaya Ana, y el plan de absorción es completamente distinto;
 *  - `requestedAt` — sin él, una aprobación vieja revive un pedido nuevo del
 *    mismo usuario, que es justo lo que `mergeApprovals` evita al no arrastrar
 *    aprobaciones entre rondas.
 *
 * Y el `plan` entero va adentro. Es lo que hace que aprobar signifique algo:
 * sin el plan firmado, quien se va junta las aprobaciones de todos y después
 * cambia quién absorbe cuánto, con las firmas intactas.
 */
export function leaveApprovalStatement(
  groupId: string,
  request: { userId: string; requestedAt: number; plan: unknown },
  a: LeaveApproval,
): Record<string, unknown> {
  return {
    v: LEAVE_APPROVAL_VERSION,
    t: 'leave_approval',
    groupId,
    leavingUserId: request.userId,
    requestedAt:   request.requestedAt,
    plan:          request.plan,
    userId:        a.userId,
    approvedAt:    a.approvedAt,
  };
}

export function canonicalLeaveApproval(
  groupId: string,
  request: { userId: string; requestedAt: number; plan: unknown },
  a: LeaveApproval,
): string {
  return canonical(leaveApprovalStatement(groupId, request, a));
}
