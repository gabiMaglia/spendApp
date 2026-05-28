import { create } from 'zustand';
import { createStorage } from '@/src/utils/createStorage';
import type { Payment } from '@/src/types/models';

const storage = createStorage('payments');
const KEY = 'data_v1';

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
    const payments = raw ? (JSON.parse(raw) as Payment[]) : [];
    set({ payments, isLoading: false });
  },
}));
