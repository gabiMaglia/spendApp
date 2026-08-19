import type { Group, LeaveRequest } from '@/src/types/models';

/**
 * Ronda de aprobación para salir de un grupo con saldo abierto.
 *
 * La regla del PO: se sale libremente sólo si no hay cuentas abiertas; con saldo
 * pendiente hace falta que **todos** aprueben y decidir quién absorbe.
 *
 * El pedido vive en el `Group`, así que viaja por el sync sin nada especial. Lo
 * único que necesita trato aparte son las **aprobaciones**: ver `mergeApprovals`.
 */

/** Quiénes tienen que aprobar: todos los que quedan, no el que se va. */
export function approversNeeded(group: Group, leavingUserId: string): string[] {
  return group.memberIds.filter(id => id !== leavingUserId);
}

export function isApprovedByAll(group: Group, request: LeaveRequest): boolean {
  const necesarios = approversNeeded(group, request.userId);
  if (necesarios.length === 0) return false; // nadie a quien pasarle el saldo

  const aprobaron = new Set(request.approvedBy);
  return necesarios.every(id => aprobaron.has(id));
}

/** Cuántos faltan. Sirve para mostrar "2 de 3" sin recalcular en la pantalla. */
export function approvalProgress(group: Group, request: LeaveRequest): { got: number; need: number } {
  const necesarios = approversNeeded(group, request.userId);
  const aprobaron = new Set(request.approvedBy);
  return {
    got: necesarios.filter(id => aprobaron.has(id)).length,
    need: necesarios.length,
  };
}

/**
 * Une dos versiones del mismo pedido conservando TODAS las aprobaciones.
 *
 * Es lo que impide que el pedido se trabe para siempre: el `Group` se mergea por
 * LWW, así que si Ana y Beto aprueban cada uno en su teléfono antes de
 * sincronizar, el registro con `updatedAt` menor se descarta entero y esa
 * aprobación desaparece. Nadie se entera; el pedido simplemente nunca junta las
 * firmas.
 *
 * Las aprobaciones son un conjunto que sólo crece, así que unirlas siempre es
 * seguro. Si los pedidos son distintos (otra ronda), gana el más nuevo y las
 * aprobaciones viejas NO se arrastran: aprobaron otro plan.
 */
export function mergeApprovals(
  a: LeaveRequest | undefined,
  b: LeaveRequest | undefined,
): LeaveRequest | undefined {
  if (!a) return b;
  if (!b) return a;

  const mismaRonda = a.userId === b.userId && a.requestedAt === b.requestedAt;
  if (!mismaRonda) return a.requestedAt >= b.requestedAt ? a : b;

  return { ...a, approvedBy: [...new Set([...a.approvedBy, ...b.approvedBy])] };
}
