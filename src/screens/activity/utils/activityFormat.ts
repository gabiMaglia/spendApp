import { mismaPersona } from '@/src/store/identityAlias';
import type { ActivityKind } from '@/src/store/selectors';
import type { Expense } from '@/src/types/models';

export function relativeTime(ts: number): string {
  const diffMs  = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH   = Math.floor(diffMs / 3600000);
  const diffD   = Math.floor(diffMs / 86400000);

  if (diffMin < 1)  return 'ahora';
  if (diffMin < 60) return `hace ${diffMin} min`;
  if (diffH   < 24) return `hace ${diffH} h`;
  if (diffD   === 1) return 'ayer';
  return `hace ${diffD} días`;
}

export function getTs(ev: ActivityKind): number {
  if (ev.kind === 'expense_added' || ev.kind === 'expense_delete_request') return ev.expense.date;
  if (ev.kind === 'expense_deleted' || ev.kind === 'expense_restored') {
    return ev.expense.updatedAt || ev.expense.date;
  }
  if (ev.kind === 'personal_entry') return ev.entry.date;
  return ev.payment.date;
}

/**
 * **Tu parte de ESE gasto puntual** (PO 2026-09-22): el monto grande de la
 * fila es el TOTAL del gasto, no lo que te toca a vos — dos personas que
 * miran la misma fila de "Asado $20.000" no saben, sin abrir el detalle, si
 * eso las beneficia o las perjudica. Devuelve `null` si no participaste de
 * este gasto puntual (no hay nada que mostrar), y el signo ya resuelto:
 * positivo = te deben tu parte, negativo = debés la tuya.
 */
export function miParteDelGasto(expense: Expense, currentUserId: string): number | null {
  const miSplit = expense.splits.find(s => mismaPersona(s.userId, currentUserId));
  if (!miSplit) return null;

  if (mismaPersona(expense.paidById, currentUserId)) {
    const teDeben = expense.amount - miSplit.amount;
    return teDeben > 0 ? teDeben : null;
  }
  return miSplit.amount > 0 ? -miSplit.amount : null;
}
