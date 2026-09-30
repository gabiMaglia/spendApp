import type { Group, Expense, Payment } from '@/src/types/models';
import { rosterDe } from '@/src/algorithms/roster';
import { deudasDelGrupo } from '@/src/algorithms/deudasDelGrupo';
import { tieneDeudaViva } from '@/src/algorithms/deudaViva';
import { pagosQueCuentan } from '@/src/algorithms/settlementStatus';

/**
 * T-187 + T-228: al borrar la cuenta, de qué grupos sale sola — sólo de los
 * que no tiene ninguna deuda viva en ninguna dirección (la misma regla que
 * salir a mano). Donde la tiene, el grupo la sigue viendo como «Cuenta
 * borrada» con la deuda visible.
 */
export function gruposParaSalir(
  accountId: string,
  groups: readonly Group[],
  expenses: readonly Expense[],
  payments: readonly Payment[],
): string[] {
  return groups
    .filter(g => !g.isDeleted && rosterDe(g.miembros).includes(accountId))
    .filter(g => {
      const deudas = deudasDelGrupo(
        expenses.filter(e => e.groupId === g.id),
        pagosQueCuentan(payments, g),
        rosterDe(g.miembros),
      );
      return !tieneDeudaViva(deudas, accountId);
    })
    .map(g => g.id);
}
