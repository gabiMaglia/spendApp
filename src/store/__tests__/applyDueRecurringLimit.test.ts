import { applyDueRecurring } from '../session';
import { useGroupStore } from '../groupStore';
import { useExpenseStore } from '../expenseStore';
import { useRecurringStore } from '../recurringStore';
import { useArchiveStore } from '../archiveStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { LIMITE_GASTOS_GRUPO } from '@/src/constants/groupLimits';
import type { Group, Expense, RecurringExpense } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

const DAY_MS = 86_400_000;
const START = 1_000_000_000_000;

function grupo(over: Partial<Group> = {}): Group {
  return {
    id: 'g1', name: 'Depto', memberIds: ['ana', 'beto'], currency: 'ARS',
    createdAt: 1, updatedAt: 1, isDeleted: false, createdById: 'ana', deletionVotes: [],
    ...over,
  };
}

function gastoViejo(id: string): Expense {
  return {
    id, groupId: 'g1', description: 'x', amount: 1_000, currency: 'ARS',
    paidById: 'ana', splits: [{ userId: 'beto', amount: 500, isPaid: false }],
    splitMode: 'equal', category: 'other', date: 1, createdAt: 1, updatedAt: 1,
    createdById: 'ana', isDeleted: false, deletionVotes: [],
  } as Expense;
}

function recurrenteSemanal(): RecurringExpense {
  return {
    id: 'r1', groupId: 'g1', description: 'Alquiler', amount: 50_000, currency: 'ARS',
    paidById: 'ana', splitMode: 'equal', memberIds: ['ana', 'beto'], category: 'other',
    rule: { frequency: 'weekly', startDate: START },
    lastMaterializedAt: START, // ya se materializó la ocurrencia 0
    isActive: true, createdAt: START, updatedAt: START, isDeleted: false,
  } as RecurringExpense;
}

beforeEach(() => {
  (['groups', 'expenses', 'recurring'] as const).forEach(b => createSecureStorage(b).clearAll());
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
});

describe('applyDueRecurring — límite de gastos por grupo', () => {
  it('si un recurrente empuja al grupo por encima del límite, el grupo se archiva con reason "limit"', () => {
    useGroupStore.setState({ groups: [grupo()] });
    const yaHabia = Array.from({ length: LIMITE_GASTOS_GRUPO - 1 }, (_, i) => gastoViejo(`e${i}`));
    useExpenseStore.setState({ expenses: yaHabia });
    useRecurringStore.setState({ recurring: [recurrenteSemanal()] });

    // una semana después del último vencimiento materializado ⇒ exactamente 1 ocurrencia nueva
    applyDueRecurring(START + 7 * DAY_MS + 1);

    expect(useExpenseStore.getState().expenses).toHaveLength(LIMITE_GASTOS_GRUPO);
    expect(useArchiveStore.getState().isArchived('g1')).toBe(true);
    expect(useArchiveStore.getState().archiveReason('g1')).toBe('limit');
  });

  it('no archiva si el grupo queda por debajo del límite', () => {
    useGroupStore.setState({ groups: [grupo()] });
    useExpenseStore.setState({ expenses: [gastoViejo('e0')] });
    useRecurringStore.setState({ recurring: [recurrenteSemanal()] });

    applyDueRecurring(START + 7 * DAY_MS + 1);

    expect(useArchiveStore.getState().isArchived('g1')).toBe(false);
  });

  it('una carrera que salte varios gastos de una (452, 461, lo que sea) igual archiva, sin drama por el número exacto', () => {
    useGroupStore.setState({ groups: [grupo()] });
    const yaHabia = Array.from({ length: LIMITE_GASTOS_GRUPO + 10 }, (_, i) => gastoViejo(`e${i}`));
    useExpenseStore.setState({ expenses: yaHabia });
    useRecurringStore.setState({ recurring: [recurrenteSemanal()] });

    applyDueRecurring(START + 7 * DAY_MS + 1);

    expect(useArchiveStore.getState().isArchived('g1')).toBe(true);
    expect(useArchiveStore.getState().archiveReason('g1')).toBe('limit');
  });

  it('no toca recurrentes personales (groupId vacío) al calcular el límite', () => {
    useExpenseStore.setState({ expenses: [] });
    useRecurringStore.setState({
      recurring: [{ ...recurrenteSemanal(), id: 'r-personal', groupId: '' }],
    });

    expect(() => applyDueRecurring(START + 7 * DAY_MS + 1)).not.toThrow();
    expect(useArchiveStore.getState().archivedIds).toHaveLength(0);
  });
});
