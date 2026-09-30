import { calculateBalancesByCurrency } from '@/src/algorithms/calculateBalances';
import { pagosQueCuentan } from '@/src/algorithms/settlementStatus';
import { deudasDelGrupo, type DeudaPar } from '@/src/algorithms/deudasDelGrupo';
import { idCanonico } from '@/src/store/identityAlias';
import type { CurrencyCode } from '@/src/constants/currencies';
import type { Expense, Group, Payment } from '@/src/types/models';

/** Lógica pura del detalle de grupo. T-223: salió de `app/groups/[id].tsx`. */

export type TimelineItem =
  | { type: 'expense'; data: Expense; ts: number }
  | { type: 'payment'; data: Payment; ts: number };

/** Gastos y pagos vivos del grupo, mezclados y con lo más nuevo arriba. */
export function armarTimeline(
  expenses: readonly Expense[], payments: readonly Payment[], groupId: string | undefined,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const e of expenses) {
    if (e.groupId === groupId && !e.isDeleted) items.push({ type: 'expense', data: e, ts: e.date });
  }
  for (const p of payments) {
    if (p.groupId === groupId && !p.isDeleted) items.push({ type: 'payment', data: p, ts: p.date });
  }
  return items.sort((a, b) => b.ts - a.ts);
}

/** Lo que un miembro todavía debe o le deben en el grupo, sólo monedas con saldo. */
export function saldoPendienteDe(
  uid: string, expenses: readonly Expense[], payments: readonly Payment[], group: Group,
): { currency: CurrencyCode; amount: number }[] {
  const gastosDelGrupo = expenses.filter(e => e.groupId === group.id);
  const pagosDelGrupo = pagosQueCuentan(payments, group);
  const balances = calculateBalancesByCurrency(gastosDelGrupo, pagosDelGrupo, group.memberIds);
  return (balances.find(b => b.userId === uid)?.balances ?? []).filter(b => b.amount !== 0);
}

/** Deuda por par del grupo (T-225), con los mismos pagos que cuentan que el resto del detalle. */
export function deudasDeGrupo(
  expenses: readonly Expense[], payments: readonly Payment[], group: Group,
): DeudaPar[] {
  return deudasDelGrupo(
    expenses.filter(e => e.groupId === group.id), pagosQueCuentan(payments, group), group.memberIds,
  );
}

type Monto = { currency: CurrencyCode; amount: number };
export type CuentasConPersona = { userId: string; meDebe: Monto[]; leDebo: Monto[] };

/**
 * Con cada persona que tiene algo pendiente conmigo: lo que me debe y lo que le
 * debo, por moneda y sin compensar (T-225). Es lo que dicen los avisos de
 * expulsar y de salir: el PO quiere saber a quién le debe y quién le debe.
 */
export function cuentasPorPersona(deudas: readonly DeudaPar[], yo: string): CuentasConPersona[] {
  const mio = idCanonico(yo);
  const porPersona = new Map<string, CuentasConPersona>();
  const de = (uid: string) => {
    let c = porPersona.get(uid);
    if (!c) { c = { userId: uid, meDebe: [], leDebo: [] }; porPersona.set(uid, c); }
    return c;
  };
  for (const d of deudas) {
    if (d.acreedor === mio) de(d.deudor).meDebe.push({ currency: d.currency, amount: d.monto });
    else if (d.deudor === mio) de(d.acreedor).leDebo.push({ currency: d.currency, amount: d.monto });
  }
  return [...porPersona.values()];
}
