/**
 * QA D1 (rechazo T-006, P-2): el guard de idempotencia `money_int_v1_done`
 * (ADR-002 §6) no tenía ningún test que lo ejerciera vía `hydrate()` — el
 * test anterior (`moneyMigration.test.ts`) solo prueba las funciones puras
 * de conversión, nunca el guard en sí. QA mutó `expenseStore.ts` borrando
 * el `if (!storage.getBoolean(MONEY_MIGRATION_KEY))` y los 110 tests
 * siguieron todos verdes: el guard podía desaparecer sin que nada lo note.
 *
 * Este archivo ejerce el guard REAL de los 3 stores (expense/payment/
 * personal) a través de `hydrate()`, contra el storage MMKV (mockeado en
 * `test-utils/setup.ts`):
 *   1. Siembra un blob PRE-migración (montos en float, sin el flag).
 *   2. Primer `hydrate()` → confirma conversión a entero (menor unidad) y
 *      que el flag quedó seteado.
 *   3. Segundo `hydrate()` sobre el MISMO storage → confirma que NO se
 *      vuelve a convertir (si el guard desaparece, esto multiplica el
 *      monto otra vez por el factor y el test falla).
 *
 * Cada store corre dentro de su propio `jest.isolateModules()`: el mock de
 * `react-native-mmkv` en `test-utils/setup.ts` comparte un único Map interno
 * sin distinguir el `id` de `MMKV({ id })`, así que sin aislar, los 3
 * stores (que usan la misma KEY literal `data_v1`/`entries_v1`) pisarían
 * el storage entre sí dentro del mismo archivo de test. `isolateModules`
 * les da un registro de módulos (y por lo tanto un Map del mock) fresco e
 * independiente a cada uno.
 */

import type { Expense, Payment, PersonalBudget, PersonalEntry } from '@/src/types/models';

describe('money migration guard (D1) — expenseStore', () => {
  it('converts float amounts to minor units on first hydrate, and does NOT re-convert on a second hydrate', () => {
    jest.isolateModules(() => {
      const { createSecureStorage } = require('@/src/utils/secureStorage');
      const seed = createSecureStorage('expenses');

      const floatExpense: Expense = {
        id: 'e1', updatedAt: 0, isDeleted: false, groupId: 'g1',
        description: 'Test', amount: 1500, currency: 'ARS', paidById: 'u1',
        splits: [
          { userId: 'u1', amount: 750, isPaid: false },
          { userId: 'u2', amount: 750, isPaid: false },
        ],
        splitMode: 'equal', category: 'other', date: 0, createdAt: 0,
        createdById: 'u1', deletionVotes: [],
      };
      seed.set('data_v1', JSON.stringify([floatExpense]));
      expect(seed.getBoolean('money_int_v1_done')).toBeFalsy();

      require('../authStore').useAuthStore.setState({ currentUser: { id: 'u1' } });
      const { useExpenseStore } = require('../expenseStore');

      useExpenseStore.getState().hydrate();
      const firstPass = useExpenseStore.getState().expenses;
      expect(firstPass[0].amount).toBe(150000); // 1500 * 100 (ARS, 2 decimales)
      expect(firstPass[0].splits[0].amount).toBe(75000);
      expect(firstPass[0].splits[1].amount).toBe(75000);
      expect(seed.getBoolean('money_int_v1_done')).toBe(true);

      // Segundo hydrate sobre el MISMO storage: el guard debe impedir
      // reconvertir. Si el guard fue borrado, esto daría 15000000.
      useExpenseStore.getState().hydrate();
      const secondPass = useExpenseStore.getState().expenses;
      expect(secondPass[0].amount).toBe(150000);
      expect(secondPass[0].splits[0].amount).toBe(75000);
    });
  });
});

describe('money migration guard (D1) — paymentStore', () => {
  it('converts float amounts to minor units on first hydrate, and does NOT re-convert on a second hydrate', () => {
    jest.isolateModules(() => {
      const { createSecureStorage } = require('@/src/utils/secureStorage');
      const seed = createSecureStorage('payments');

      const floatPayment: Payment = {
        id: 'p1', updatedAt: 0, isDeleted: false, groupId: 'g1',
        fromUserId: 'u1', toUserId: 'u2', amount: 250.5, currency: 'ARS',
        date: 0, createdAt: 0, createdById: 'u1',
      };
      seed.set('data_v1', JSON.stringify([floatPayment]));
      expect(seed.getBoolean('money_int_v1_done')).toBeFalsy();

      require('../authStore').useAuthStore.setState({ currentUser: { id: 'u1' } });
      const { usePaymentStore } = require('../paymentStore');

      usePaymentStore.getState().hydrate();
      const firstPass = usePaymentStore.getState().payments;
      expect(firstPass[0].amount).toBe(25050); // 250.5 * 100
      expect(seed.getBoolean('money_int_v1_done')).toBe(true);

      usePaymentStore.getState().hydrate();
      const secondPass = usePaymentStore.getState().payments;
      expect(secondPass[0].amount).toBe(25050); // NO 2505000
    });
  });
});

describe('money migration guard (D1) — personalStore', () => {
  it('converts entries and budget to minor units on first hydrate, and does NOT re-convert on a second hydrate', () => {
    jest.isolateModules(() => {
      const { createSecureStorage } = require('@/src/utils/secureStorage');
      const seed = createSecureStorage('personal');

      const floatEntry: PersonalEntry = {
        id: 'pe1', updatedAt: 0, isDeleted: false, kind: 'expense',
        description: 'Test', amount: 100, currency: 'ARS', category: 'other',
        date: 0, createdAt: 0,
      };
      const floatBudget: PersonalBudget = {
        currency: 'ARS', monthlyAmount: 500, includeOwedToMe: false,
      };
      seed.set('entries_v1', JSON.stringify([floatEntry]));
      seed.set('budget_v1', JSON.stringify(floatBudget));
      expect(seed.getBoolean('money_int_v1_done')).toBeFalsy();

      require('../authStore').useAuthStore.setState({ currentUser: { id: 'u1' } });
      const { usePersonalStore } = require('../personalStore');

      usePersonalStore.getState().hydrate();
      const firstEntries = usePersonalStore.getState().entries;
      const firstBudget  = usePersonalStore.getState().budget;
      expect(firstEntries[0].amount).toBe(10000); // 100 * 100
      expect(firstBudget.monthlyAmount).toBe(50000); // 500 * 100
      expect(seed.getBoolean('money_int_v1_done')).toBe(true);

      usePersonalStore.getState().hydrate();
      const secondEntries = usePersonalStore.getState().entries;
      const secondBudget  = usePersonalStore.getState().budget;
      expect(secondEntries[0].amount).toBe(10000); // NO 1000000
      expect(secondBudget.monthlyAmount).toBe(50000); // NO 5000000
    });
  });
});
