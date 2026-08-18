import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';
import { mergeByIdLWW } from './lww';
import { schedulePublish } from '@/src/sync/relayEngine';
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
  writeScoped(storage, KEY, JSON.stringify(payments));
}

export const usePaymentStore = create<PaymentStoreState>((set, get) => ({
  payments: [],
  isLoading: true,

  getByGroupId: (groupId) =>
    get().payments.filter(p => p.groupId === groupId && !p.isDeleted),

  // Saldar una deuda tiene que verse del otro lado igual que un gasto: si no,
  // el que pagó ve su saldo en cero y el otro le sigue reclamando.
  addPayment: (payment) => {
    const payments = [...get().payments, payment];
    persist(payments);
    set({ payments });

    if (payment.groupId) schedulePublish(payment.groupId);
  },

  updatePayment: (id, patch) => {
    const payments = get().payments.map(p =>
      p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p,
    );
    persist(payments);
    set({ payments });

    const groupId = payments.find(p => p.id === id)?.groupId;
    if (groupId) schedulePublish(groupId);
  },

  // LWW merge para sync P2P
  mergePayments: (incoming) => {
    const merged = mergeByIdLWW(get().payments, incoming);
    persist(merged);
    set({ payments: merged });
  },

  hydrate: () => {
    const raw = readScoped(storage, KEY);
    // Un dato corrupto NO puede tirar acá: hydrate corre en el arranque de la app
    // (app/_layout.tsx) y una excepción deja isLoading en true para siempre,
    // trabando la pantalla de carga sin salida. Ya pasó con la sesión (T-020);
    // estos stores habían quedado sin la misma protección.
    let payments: Payment[] = [];
    try {
      payments = raw ? (JSON.parse(raw) as Payment[]) : [];
    } catch {
      payments = [];
    }

    // Conversión one-shot de datos existentes (float → entero, ADR-002 §6).
    if (!storage.getBoolean(MONEY_MIGRATION_KEY)) {
      payments = migratePaymentAmounts(payments);
      persist(payments);
      storage.set(MONEY_MIGRATION_KEY, true);
    }

    set({ payments, isLoading: false });
  },
}));
