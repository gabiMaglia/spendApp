import i18n from '@/src/i18n';
import { mismaPersona } from '@/src/store/identityAlias';
import type { ActivityKind } from '@/src/store/selectors';
import type { Expense } from '@/src/types/models';

/** «hace 6 h» / «6 h ago» / «há 6 h» en el idioma activo (T-307: antes, castellano fijo). */
export function relativeTime(ts: number): string {
  const diffMs  = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH   = Math.floor(diffMs / 3600000);
  const diffD   = Math.floor(diffMs / 86400000);

  if (diffMin < 1)  return i18n.t('activity.time_now');
  if (diffMin < 60) return i18n.t('activity.time_minutes', { count: diffMin });
  if (diffH   < 24) return i18n.t('activity.time_hours', { count: diffH });
  if (diffD   === 1) return i18n.t('activity.time_yesterday');
  return i18n.t('activity.time_days', { count: diffD });
}

export function getTs(ev: ActivityKind): number {
  if (ev.kind === 'expense_added') return ev.expense.date;
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
