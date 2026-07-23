import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { migratePaymentAmounts } from './moneyMigration';
import type { Payment } from '@/src/types/models';

const storage = createSecureStorage('payments');
const KEY = 'data_v1';
// Guard de idempotencia de la conversión float→entero de montos (ADR-002 §6).
const MONEY_MIGRATION_KEY = 'money_int_v1_done';

interface PaymentStoreState {
  payments: Payment[];
  isLoading: boolean;
  getByGroupId: (groupId: string) => Payment[];
  addPayment: (payment: Payment) => void;
  updatePayment: (id: string, patch: Partial<Payment>) => void;
  mergePayments: (incoming: Payment[]) => void;
  hydrate: () => void;
}

function persist(payments: Payment[]) {
  storage.set(KEY, JSON.stringify(payments));
}

export const usePaymentStore = create<PaymentStoreState>((set, get) => ({
  payments: [],
  isLoading: true,

  getByGroupId: (groupId) =>
    get().payments.filter(p => p.groupId === groupId && !p.isDeleted),

  addPayment: (payment) => {
    const payments = [...get().payments, payment];
    persist(payments);
    set({ payments });
  },

  updatePayment: (id, patch) => {
    const payments = get().payments.map(p =>
      p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p,
    );
    persist(payments);
    set({ payments });
  },

  // LWW merge para sync P2P
  mergePayments: (incoming) => {
    const current = get().payments;
    const merged = [...current];
    for (const inc of incoming) {
      const idx = merged.findIndex(p => p.id === inc.id);
      if (idx === -1) {
        merged.push(inc);
      } else if (inc.updatedAt > merged[idx].updatedAt) {
        merged[idx] = inc;
      }
    }
    persist(merged);
    set({ payments: merged });
  },

  hydrate: () => {
    const raw = storage.getString(KEY);
    let payments = raw ? (JSON.parse(raw) as Payment[]) : [];

    // Conversión one-shot de datos existentes (float → entero, ADR-002 §6).
    if (!storage.getBoolean(MONEY_MIGRATION_KEY)) {
      payments = migratePaymentAmounts(payments);
      persist(payments);
      storage.set(MONEY_MIGRATION_KEY, true);
    }

    set({ payments, isLoading: false });
  },
}));
