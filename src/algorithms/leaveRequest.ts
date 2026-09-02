import { canonical } from '@/src/store/lww';
import { normalizarAprobaciones } from '@/src/sync/leaveApprovalCore';
import type { ApprovalEntry, Group, LeaveApproval, LeaveRequest } from '@/src/types/models';

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

/**
 * Decide si UNA aprobación firmada cierra. La provee quien llama porque
 * verificar necesita las claves del autor, y esto es una función pura.
 */
export type VerificaAprobacion = (a: LeaveApproval) => boolean;

/**
 * **Las aprobaciones que cuentan de verdad** (T-065).
 *
 * En un pedido `v: 2` sólo cuentan las que **verifican**. Sin esto, el conjunto
 * se une sin preguntar quién escribió cada id y el que se va escribe los de
 * todos los demás — reproducido con test: `isApprovedByAll` daba `true` sin una
 * sola aprobación real, y eso dispara los pagos de absorción en el teléfono de
 * todos.
 *
 * En un pedido anterior a T-065 se cuenta como antes. No es una concesión
 * gratuita: exigir firma retroactivamente trabaría una salida ya en curso, y
 * los pedidos viejos se vencen solos. Es el mismo criterio que las rondas de
 * borrado de T-041 S8.
 *
 * **Fail-closed**: sin verificador, un pedido `v: 2` no cuenta ninguna. Quien
 * necesite la respuesta de verdad tiene que traer con qué verificar; el default
 * seguro es "no alcanza", nunca "alcanza".
 */
export function aprobadoresValidos(
  request: LeaveRequest, verifica?: VerificaAprobacion,
): Set<string> {
  const entradas = normalizarAprobaciones(request.approvedBy);
  if (request.v !== 2) return new Set(entradas.map(a => a.userId));
  if (!verifica) return new Set();
  return new Set(entradas.filter(verifica).map(a => a.userId));
}

export function isApprovedByAll(
  group: Group, request: LeaveRequest, verifica?: VerificaAprobacion,
): boolean {
  const necesarios = approversNeeded(group, request.userId);
  if (necesarios.length === 0) return false; // nadie a quien pasarle el saldo

  const aprobaron = aprobadoresValidos(request, verifica);
  return necesarios.every(id => aprobaron.has(id));
}

/** Cuántos faltan. Sirve para mostrar "2 de 3" sin recalcular en la pantalla. */
export function approvalProgress(
  group: Group, request: LeaveRequest, verifica?: VerificaAprobacion,
): { got: number; need: number } {
  const necesarios = approversNeeded(group, request.userId);
  const aprobaron = aprobadoresValidos(request, verifica);
  return {
    got: necesarios.filter(id => aprobaron.has(id)).length,
    need: necesarios.length,
  };
}

/** ¿Esta persona ya aprobó? Cuenta la entrada, firmada o no: es idempotencia. */
export function yaAprobo(request: LeaveRequest, userId: string): boolean {
  return normalizarAprobaciones(request.approvedBy).some(a => a.userId === userId);
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

  // Se une por CONTENIDO canónico, no por identidad: una aprobación firmada y
  // un id pelado de la misma persona son entradas distintas y las dos tienen
  // que sobrevivir — la firmada es la que cuenta en un pedido `v: 2`, y
  // colapsarlas por `userId` podría quedarse justo con la que no vale.
  const porContenido = new Map<string, ApprovalEntry>();
  for (const e of [...a.approvedBy, ...b.approvedBy]) porContenido.set(canonical(e), e);
  return { ...a, approvedBy: [...porContenido.values()] };
}
