import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScopedLazy } from './userScope';
import { mergeByIdLevels } from './mergeLevels';
import { siguienteUpdatedAt } from './relojDelMerge';
import { signOnCreate, signOnEdit } from '@/src/sync/confianza/signOnWrite';
import { schedulePublish } from '@/src/sync/motor/relayEngine';
import { migratePaymentAmounts } from './moneyMigration';
import type { Payment } from '@/src/types/models';
import { syncedNow } from '@/src/utils/syncedClock';
import { recordError } from '@/src/services/errorLog';

const storage = createSecureStorage('payments');
const KEY = 'data_v1';
// Guard de idempotencia de la conversión float→entero de montos (ADR-002 §6).
const MONEY_MIGRATION_KEY = 'money_int_v1_done';

/**
 * Un pago DERIVADO no lo declara este dispositivo: sale de un plan de salida ya
 * aprobado y lo materializa cualquiera que corra la resolución. Ver S9 del plan
 * de T-041 (`derivedFrom`).
 */
export interface AddPaymentOpts { derived?: boolean }

interface PaymentStoreState {
  payments: Payment[];
  isLoading: boolean;
  addPayment: (payment: Payment, opts?: AddPaymentOpts) => void;
  /** `false` = la edición NO se guardó (T-152 · D2). Ver `expenseStore.updateExpense`. */
  updatePayment: (id: string, patch: Partial<Payment>) => boolean;
  mergePayments: (incoming: Payment[], now?: number) => void;
  hydrate: () => void;
}

function persist(payments: Payment[]) {
  writeScopedLazy(storage, KEY, () => JSON.stringify(payments));
}

export const usePaymentStore = create<PaymentStoreState>((set, get) => ({
  payments: [],
  isLoading: true,

  // Saldar una deuda tiene que verse del otro lado igual que un gasto: si no,
  // el que pagó ve su saldo en cero y el otro le sigue reclamando.
  addPayment: (payment, opts) => {
    // `derived` = pago emitido en nombre de otro a partir de un plan de salida
    // (`applyLeave`). No se firma: su autoría no es de este device aunque el
    // `createdById` coincida con la sesión. Ver `signOnCreate`.
    const nuevo = opts?.derived ? payment : signOnCreate('payment', payment);
    const payments = [...get().payments, nuevo];
    persist(payments);
    set({ payments });

    if (payment.groupId) schedulePublish(payment.groupId);
  },

  updatePayment: (id, patch) => {
    const actual = get().payments.find(p => p.id === id);
    if (!actual) return true;

    const ahora = syncedNow();
    const firmado = signOnEdit('payment', actual, {
      ...actual, ...patch, updatedAt: siguienteUpdatedAt(actual.updatedAt, ahora),
    });
    if (firmado === null) {
      recordError({
        message: 'signOnEdit bloqueado: no se pudo re-firmar una edición propia de un pago ya firmado',
        fatal: false,
      });
      return false;
    }

    const payments = get().payments.map(p => (p.id === id ? firmado : p));
    persist(payments);
    set({ payments });

    if (firmado.groupId) schedulePublish(firmado.groupId);
    return true;
  },

  // Merge por niveles (T-041 · S7) con tope de reloj (T-144). Ver comentario
  // equivalente en `expenseStore.mergeExpenses`.
  mergePayments: (incoming, now = syncedNow()) => {
    const merged = mergeByIdLevels('payment', get().payments, incoming, now);
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
