import { useMemo } from 'react';
import type { CurrencyCode } from '@/src/constants/currencies';
import type { Expense, Group, Payment } from '@/src/types/models';
import { directedDebts, type DirectedDebt } from '@/src/algorithms/directedDebts';
import { deudasDelGrupo, totalesDeUsuario, type DeudaPar } from '@/src/algorithms/deudasDelGrupo';
import { pagosQueCuentan } from '@/src/algorithms/settlementStatus';
import { idCanonico, mismaPersona } from '@/src/store/identityAlias';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useArchiveStore } from '@/src/store/archiveStore';

/**
 * **Selectores de deuda, sin compensar** (T-225, PO 2026-09-29 — enmienda
 * ADR-006 d1). Salieron de `selectors.ts` (que los re-exporta) y todos parten
 * de la misma fuente: `deudasDelGrupo`, la deuda por par y moneda de cada grupo.
 *
 * - Te deben / Debés (Grupos, Personal, Amigos, detalle): brutos, por separado.
 * - La tarjeta de cada contacto en Amigos: neto de esa persona (me debe − le debo).
 */

export interface GroupsTotalBalance {
  currency: CurrencyCode;
  owedToYou: number;
  youOwe: number;
}

export interface PersonBalance {
  userId: string;
  currency: CurrencyCode;
  amount: number; // positivo = esa persona me debe (neto), negativo = le debo yo
}

/**
 * Las deudas de cada grupo que cuenta para mí: no borrado, no archivado y del
 * que soy parte. Un grupo borrado no se puede saldar; uno archivado ya tiene su
 * saldo trasladado (T-058) o lo saqué a mano de la vista, y sumarlo lo contaría
 * dos veces; y «ser parte» incluye estar en el roster con la identidad vieja
 * (T-048 · D-6), si no un grupo heredado desaparecía con sus saldos adentro.
 */
function deudasDeMisGrupos(
  groups: Group[], expenses: Expense[], payments: Payment[], archivedIds: string[], userId: string,
): DeudaPar[][] {
  const out: DeudaPar[][] = [];
  for (const group of groups) {
    if (group.isDeleted || archivedIds.includes(group.id)) continue;
    if (!group.memberIds.some(m => mismaPersona(m, userId))) continue;
    out.push(deudasDelGrupo(
      expenses.filter(e => e.groupId === group.id),
      pagosQueCuentan(payments, group),
      group.memberIds,
    ));
  }
  return out;
}

function useDeudasDeMisGrupos(userId: string): DeudaPar[][] {
  const groups   = useGroupStore(s => s.groups);
  const expenses = useExpenseStore(s => s.expenses);
  const payments = usePaymentStore(s => s.payments);
  const archivedIds = useArchiveStore(s => s.archivedIds);
  return useMemo(
    () => deudasDeMisGrupos(groups, expenses, payments, archivedIds, userId),
    [groups, expenses, payments, archivedIds, userId],
  );
}

/** Te deben / Debés globales de Grupos: suma de lo que me deben y de lo que debo, sin compensar. */
export function useGroupsTotalBalance(userId: string): GroupsTotalBalance[] {
  const porGrupo = useDeudasDeMisGrupos(userId);
  return useMemo(() => {
    const totals = new Map<CurrencyCode, GroupsTotalBalance>();
    for (const deudas of porGrupo) {
      for (const t of totalesDeUsuario(deudas, userId)) {
        const prev = totals.get(t.currency) ?? { currency: t.currency, owedToYou: 0, youOwe: 0 };
        totals.set(t.currency, {
          currency: t.currency, owedToYou: prev.owedToYou + t.owedToYou, youOwe: prev.youOwe + t.youOwe,
        });
      }
    }
    return [...totals.values()].filter(t => t.owedToYou > 0 || t.youOwe > 0);
  }, [porGrupo, userId]);
}

/** Te deben / Debés de UN grupo (widget de arriba del detalle de grupo). */
export function useTotalesDelGrupo(groupId: string, userId: string): GroupsTotalBalance[] {
  const group    = useGroupStore(s => s.groups.find(g => g.id === groupId));
  const expenses = useExpenseStore(s => s.expenses);
  const payments = usePaymentStore(s => s.payments);
  return useMemo(() => {
    if (!group) return [];
    const deudas = deudasDelGrupo(
      expenses.filter(e => e.groupId === group.id), pagosQueCuentan(payments, group), group.memberIds,
    );
    const totales = totalesDeUsuario(deudas, userId);
    return totales.length > 0 ? totales : [{ currency: group.currency, owedToYou: 0, youOwe: 0 }];
  }, [group, expenses, payments, userId]);
}

/**
 * Deuda DIRECCIONAL con cada persona (ADR-006): lo que me debe y lo que le debo,
 * sumados sobre todos mis grupos y nunca compensados entre sí.
 */
export function useDirectedDebts(currentUserId: string): DirectedDebt[] {
  const porGrupo = useDeudasDeMisGrupos(currentUserId);
  return useMemo(() => directedDebts(
    porGrupo.flat().map(d => ({ fromUserId: d.deudor, toUserId: d.acreedor, amount: d.monto, currency: d.currency })),
    idCanonico(currentUserId),
  ), [porGrupo, currentUserId]);
}

/** Tarjeta de cada contacto en Amigos: el neto de esa persona (me debe − le debo), por moneda. */
export function useGlobalPersonBalances(currentUserId: string): PersonBalance[] {
  const deudas = useDirectedDebts(currentUserId);
  return useMemo(() => deudas
    .map(d => ({ userId: d.userId, currency: d.currency, amount: d.owesMe - d.iOwe }))
    .filter(p => p.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)), [deudas]);
}
