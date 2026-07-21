import {
  migrateExpenseAmounts,
  migratePaymentAmounts,
  migratePersonalBudgetAmount,
  migratePersonalEntryAmounts,
} from '../moneyMigration';
import { RATE_SCALE } from '@/src/algorithms/calculateBalances';
import type { Expense, Payment, PersonalBudget, PersonalEntry } from '@/src/types/models';

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'e1',
    updatedAt: 0,
    isDeleted: false,
    groupId: 'g1',
    description: 'Test',
    amount: 100,
    currency: 'ARS',
    paidById: 'u1',
    splits: [
      { userId: 'u1', amount: 50, isPaid: false },
      { userId: 'u2', amount: 50, isPaid: false },
    ],
    splitMode: 'equal',
    category: 'other',
    date: 0,
    createdAt: 0,
    createdById: 'u1',
    deletionVotes: [],
    ...overrides,
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'p1',
    updatedAt: 0,
    isDeleted: false,
    groupId: 'g1',
    fromUserId: 'u1',
    toUserId: 'u2',
    amount: 100,
    currency: 'ARS',
    date: 0,
    createdAt: 0,
    createdById: 'u1',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<PersonalEntry> = {}): PersonalEntry {
  return {
    id: 'pe1',
    updatedAt: 0,
    isDeleted: false,
    kind: 'expense',
    description: 'Test',
    amount: 100,
    currency: 'ARS',
    category: 'other',
    date: 0,
    createdAt: 0,
    ...overrides,
  };
}

describe('migrateExpenseAmounts', () => {
  it('converts the expense amount and every split amount to minor units (2-decimal currency)', () => {
    const [migrated] = migrateExpenseAmounts([makeExpense({ amount: 100, splits: [
      { userId: 'u1', amount: 50, isPaid: false },
      { userId: 'u2', amount: 50, isPaid: false },
    ]})]);
    expect(migrated!.amount).toBe(10000);
    expect(migrated!.splits[0]!.amount).toBe(5000);
    expect(migrated!.splits[1]!.amount).toBe(5000);
  });

  it('does not apply a decimal factor for currencies with 0 decimals (CLP)', () => {
    const [migrated] = migrateExpenseAmounts([makeExpense({
      currency: 'CLP',
      amount: 1500,
      splits: [{ userId: 'u1', amount: 1500, isPaid: false }],
    })]);
    expect(migrated!.amount).toBe(1500);
    expect(migrated!.splits[0]!.amount).toBe(1500);
  });

  it('preserves every other field untouched', () => {
    const [migrated] = migrateExpenseAmounts([makeExpense({ description: 'Cena', isDeleted: true })]);
    expect(migrated!.description).toBe('Cena');
    expect(migrated!.isDeleted).toBe(true);
  });

  it('returns an empty array for an empty input (idempotent no-op)', () => {
    expect(migrateExpenseAmounts([])).toEqual([]);
  });
});

describe('migratePaymentAmounts', () => {
  it('converts the payment amount to minor units', () => {
    const [migrated] = migratePaymentAmounts([makePayment({ amount: 250.5, currency: 'ARS' })]);
    expect(migrated!.amount).toBe(25050);
  });

  it('scales exchangeRate by RATE_SCALE, NOT by minorFactor', () => {
    const [migrated] = migratePaymentAmounts([makePayment({
      amount: 100,
      currency: 'ARS',
      targetCurrency: 'USD',
      exchangeRate: 0.0011,
    })]);
    expect(migrated!.exchangeRate).toBe(Math.round(0.0011 * RATE_SCALE));
  });

  it('leaves exchangeRate undefined when the payment has no target currency', () => {
    const [migrated] = migratePaymentAmounts([makePayment({ exchangeRate: undefined })]);
    expect(migrated!.exchangeRate).toBeUndefined();
  });
});

describe('migratePersonalEntryAmounts', () => {
  it('converts each entry using its own currency', () => {
    const migrated = migratePersonalEntryAmounts([
      makeEntry({ amount: 100, currency: 'ARS' }),
      makeEntry({ id: 'pe2', amount: 1500, currency: 'CLP' }),
    ]);
    expect(migrated[0]!.amount).toBe(10000);
    expect(migrated[1]!.amount).toBe(1500);
  });

  it('returns an empty array for an empty input', () => {
    expect(migratePersonalEntryAmounts([])).toEqual([]);
  });
});

describe('migratePersonalBudgetAmount', () => {
  it('converts monthlyAmount to minor units', () => {
    const budget: PersonalBudget = { currency: 'ARS', monthlyAmount: 500, includeOwedToMe: false };
    expect(migratePersonalBudgetAmount(budget).monthlyAmount).toBe(50000);
  });

  it('keeps 0 (no budget configured) as 0', () => {
    const budget: PersonalBudget = { currency: 'ARS', monthlyAmount: 0, includeOwedToMe: false };
    expect(migratePersonalBudgetAmount(budget).monthlyAmount).toBe(0);
  });
});
