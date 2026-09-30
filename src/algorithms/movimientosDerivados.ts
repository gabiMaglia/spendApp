import type { Expense, Group, Payment, PersonalEntry } from '@/src/types/models';
import { expensePayers } from '@/src/algorithms/payers';
import { pagosQueCuentan } from '@/src/algorithms/settlementStatus';
import { idCanonico, mismaPersona } from '@/src/store/identityAlias';

type Fuentes = {
  expenses: readonly Expense[];
  payments: readonly Payment[];
  groups: readonly Group[];
  me: string;
};

/**
 * **Personal derivado** (T-229, ADR-006 d3): la plata que salió de mi bolsillo
 * y la que entró, calculada de los gastos y pagos que hay en el teléfono. No se
 * guarda: por eso sigue sola cada alta, edición, borrado, restauración y sync.
 *
 * No mira el estado del grupo: archivar o borrar un grupo no cambia lo que
 * gasté. `sourceGroupName` sale de `groups` sólo para mostrar (y para que un
 * movimiento congelado al salir del grupo conserve el nombre).
 */
export function movimientosDerivados({ expenses, payments, groups, me }: Fuentes): PersonalEntry[] {
  const nombreDe = new Map(groups.map(g => [g.id, g.name]));
  const out: PersonalEntry[] = [];

  for (const e of expenses) {
    if (e.isDeleted || e.groupId === '') continue;
    const puse = expensePayers(e)
      .filter(p => mismaPersona(p.userId, me))
      .reduce((s, p) => s + p.amount, 0);
    if (puse <= 0) continue;
    out.push({
      id: `rep_${e.id}`, kind: 'group_replicated', description: e.description, amount: puse,
      currency: e.currency, category: e.category, date: e.date, createdAt: e.createdAt,
      updatedAt: e.updatedAt, isDeleted: false,
      sourceGroupExpenseId: e.id, sourceGroupId: e.groupId, sourceGroupName: nombreDe.get(e.groupId),
    });
  }

  for (const p of payments) {
    if (p.isDeleted) continue;
    const salio = mismaPersona(p.fromUserId, me);
    const entro = mismaPersona(p.toUserId, me);
    if (salio === entro) continue; // ajeno, o de mí a mí
    out.push({
      id: `pay_${p.id}`, kind: salio ? 'payment_out' : 'payment_in', description: '',
      amount: p.amount, currency: p.currency, category: 'other', date: p.date,
      createdAt: p.createdAt, updatedAt: p.updatedAt, isDeleted: false,
      sourcePaymentId: p.id, counterpartId: idCanonico(salio ? p.toUserId : p.fromUserId),
      sourceGroupId: p.groupId, sourceGroupName: nombreDe.get(p.groupId),
    });
  }

  return out;
}

/**
 * Los derivados de un solo grupo: lo que se congela antes de purgarlo. Los
 * pagos pasan por `pagosQueCuentan`, la puerta única (guard de settlementStatus).
 */
export function derivadosDelGrupo(p: Fuentes & { groupId: string }): PersonalEntry[] {
  return movimientosDerivados({
    ...p,
    expenses: p.expenses.filter(e => e.groupId === p.groupId),
    payments: pagosQueCuentan(p.payments, p.groups.find(g => g.id === p.groupId)),
  });
}
