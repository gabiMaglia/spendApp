import type { CoreKind } from '@/src/sync/recordCore';
import type {
  Expense, Payment, ExpenseComment, RecurringExpense, Group,
} from '@/src/types/models';

/**
 * Un registro COMPLETO por entidad: todos los campos presentes, incluidos los
 * opcionales.
 *
 * El tipo es `Required<X>` a propósito. Es lo que hace que agregar un campo al
 * modelo rompa la compilación de este archivo hasta que alguien decida qué vale
 * ese campo — y de ahí en más el guard de enumeración de `recordCore.test.ts`
 * lo ve. Un fixture escrito "con los campos que uno se acuerda" deja al
 * meta-test de mutación probando menos de lo que dice probar.
 */

export const EXPENSE: Required<Expense> = {
  id: 'e-1',
  updatedAt: 5_000,
  isDeleted: false,
  groupId: 'g-1',
  description: 'Cena',
  amount: 12_345,
  currency: 'ARS',
  paidById: 'ana',
  payers: [{ userId: 'ana', amount: 12_345 }],
  splits: [
    { userId: 'ana', amount: 6_173, isPaid: true },
    { userId: 'beto', amount: 6_172, isPaid: false },
  ],
  splitMode: 'equal',
  category: 'food',
  date: 1_700_000_000_000,
  createdAt: 1_700_000_000_100,
  createdById: 'ana',
  note: 'con propina',
  receiptImageUri: 'file:///local/recibo.jpg',
  deletionVotes: [{ userId: 'beto', votedAt: 4_000, action: 'delete' }],
  rev: 2_000,
  k: '',
  s: '',
};

export const PAYMENT: Required<Payment> = {
  id: 'p-1',
  updatedAt: 5_000,
  isDeleted: false,
  groupId: 'g-1',
  fromUserId: 'beto',
  toUserId: 'ana',
  amount: 6_172,
  currency: 'ARS',
  targetCurrency: 'USD',
  exchangeRate: 1_050,
  date: 1_700_000_001_000,
  createdAt: 1_700_000_001_100,
  createdById: 'beto',
  note: 'transferencia',
  rev: 2_000,
  k: '',
  s: '',
  confirmations: [],
};

export const COMMENT: Required<ExpenseComment> = {
  id: 'c-1',
  updatedAt: 5_000,
  isDeleted: false,
  expenseId: 'e-1',
  authorId: 'beto',
  text: 'faltó la propina',
  createdAt: 1_700_000_002_000,
  rev: 2_000,
  k: '',
  s: '',
};

export const RECURRING: Required<RecurringExpense> = {
  id: 'r-1',
  updatedAt: 5_000,
  isDeleted: false,
  groupId: 'g-1',
  description: 'Alquiler',
  amount: 500_000,
  currency: 'ARS',
  paidById: 'ana',
  payers: [{ userId: 'ana', amount: 500_000 }],
  splitMode: 'percentage',
  splitValues: [50, 50],
  memberIds: ['ana', 'beto'],
  category: 'accommodation',
  rule: { frequency: 'monthly', startDate: 1_700_000_000_000, endDate: 1_800_000_000_000 },
  lastMaterializedAt: 1_700_000_003_000,
  isActive: true,
  createdAt: 1_699_000_000_000,
  createdById: 'ana',
  rev: 2_000,
  k: '',
  s: '',
};

export const GROUP: Required<Group> = {
  id: 'g-1',
  updatedAt: 5_000,
  isDeleted: false,
  name: 'Asado',
  memberIds: ['ana', 'beto'],
  currency: 'ARS',
  createdAt: 1_690_000_000_000,
  createdById: 'ana',
  deletionVotes: [{ userId: 'ana', votedAt: 4_000, action: 'delete', forced: true }],
  deletionMode: 'consensus',
  defaultSplitMode: 'equal',
  leaveRequest: {
    userId: 'beto',
    plan: [{ fromUserId: 'beto', toUserId: 'ana', amount: 100, currency: 'ARS' }],
    requestedAt: 4_500,
    approvedBy: ['ana'],
  },
  rev: 2_000,
  k: '',
  s: '',
};

export type Fixture = { kind: CoreKind; record: Record<string, unknown> };

/** Las cinco entidades firmables. Se recorren enteras en el meta-test. */
export const FIXTURES: readonly Fixture[] = [
  { kind: 'expense', record: EXPENSE },
  { kind: 'payment', record: PAYMENT },
  { kind: 'comment', record: COMMENT },
  { kind: 'recurring', record: RECURRING },
  { kind: 'group', record: GROUP },
];

/**
 * Un valor DISTINTO del que se le pasa, del mismo tipo.
 *
 * Sirve para romper un campo sin saber cuál es: el meta-test recorre los campos
 * del modelo, no una lista escrita a mano que se desactualiza.
 */
export function alter(value: unknown): unknown {
  if (value === null) return 0;
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'string') return `${value}-alterado`;
  if (typeof value === 'boolean') return !value;
  if (Array.isArray(value)) return [...value, alter(value[0] ?? 'x')];
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const [first] = Object.keys(obj);
    if (first === undefined) return { alterado: true };
    return { ...obj, [first]: alter(obj[first]) };
  }
  return 'alterado';
}
