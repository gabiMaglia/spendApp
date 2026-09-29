import type { CurrencyCode } from '@/src/constants/currencies';
import type { Expense, Group, Payment } from '@/src/types/models';
import { deudasDelGrupo, type DeudaPar } from '@/src/algorithms/deudasDelGrupo';
import type { Acreedor } from '@/src/algorithms/repartoSaldo';
import { pagosQueCuentan } from '@/src/algorithms/settlementStatus';
import { idCanonico } from '@/src/store/identityAlias';
import { gruposQueCuentan } from '@/src/algorithms/gruposQueCuentan';

/**
 * **Saldar contra lo que YO debo, sin compensar** (T-225, PO 2026-09-29).
 *
 * Saldar significa «yo no te debo más», no «estamos a mano» (ADR-006 d1): lo
 * que la otra persona me debe no achica lo que yo le pago. Montos en menor
 * unidad (ADR-002), nunca convertidos entre monedas.
 */

/** A quiénes les debo en este grupo y moneda, cada uno por lo suyo, de mayor a menor. */
export function acreedoresSinCompensar(deudas: DeudaPar[], me: string, currency: CurrencyCode): Acreedor[] {
  const yo = idCanonico(me);
  return deudas
    .filter(d => d.deudor === yo && d.currency === currency && d.monto > 0)
    .map(d => ({ userId: d.acreedor, amount: d.monto }))
    // Orden estable y explicable, igual que `acreedoresDe`: la pantalla no baila.
    .sort((a, b) => b.amount - a.amount || a.userId.localeCompare(b.userId));
}

export type PagoConAmigo = {
  groupId: string;
  groupName: string;
  /** El id del amigo tal como figura en ese grupo: el pago se ve igual que uno hecho desde el grupo. */
  toUserId: string;
  currency: CurrencyCode;
  amount: number;
};

/**
 * Saldar desde Amigos: la TOTALIDAD de lo que le debo, un pago por cada grupo
 * compartido (y por moneda, si en un grupo le debo en más de una: convertir
 * sería decidir un tipo de cambio que nadie pidió).
 *
 * Qué grupos cuentan: `gruposQueCuentan`, la MISMA regla que usa la tarjeta de
 * Amigos — si difirieran, Amigos ofrecería saldar una deuda que esta pantalla
 * no encuentra, o al revés.
 */
export function pagosParaSaldarConAmigo({
  groups, expenses, payments, archivedIds, yo, amigo,
}: {
  groups: Group[];
  expenses: Expense[];
  payments: Payment[];
  archivedIds: string[];
  yo: string;
  amigo: string;
}): PagoConAmigo[] {
  const deudor = idCanonico(yo);
  const acreedor = idCanonico(amigo);
  const out: PagoConAmigo[] = [];
  for (const group of gruposQueCuentan(groups, archivedIds, yo)) {
    const toUserId = group.memberIds.find(m => idCanonico(m) === acreedor);
    if (!toUserId) continue;

    const deudas = deudasDelGrupo(
      expenses.filter(e => e.groupId === group.id), pagosQueCuentan(payments, group), group.memberIds,
    );
    for (const d of deudas) {
      if (d.deudor !== deudor || d.acreedor !== acreedor || d.monto <= 0) continue;
      out.push({ groupId: group.id, groupName: group.name, toUserId, currency: d.currency, amount: d.monto });
    }
  }
  return out;
}

/** Total a pagar, por moneda y en el orden en que aparecen: nunca se mezclan. */
export function totalesPorMoneda(pagos: PagoConAmigo[]): { currency: CurrencyCode; amount: number }[] {
  const porMoneda = new Map<CurrencyCode, number>();
  for (const p of pagos) porMoneda.set(p.currency, (porMoneda.get(p.currency) ?? 0) + p.amount);
  return [...porMoneda.entries()].map(([currency, amount]) => ({ currency, amount }));
}
