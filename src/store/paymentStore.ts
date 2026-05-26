import { create } from 'zustand';
import type { Payment } from '@/src/types/models';
import MOCK_PAYMENTS from '@/src/mocks/payments.json';

interface PaymentStoreState {
  payments: Payment[];
  getByGroupId: (groupId: string) => Payment[];
  addPayment: (payment: Payment) => void;
}

export const usePaymentStore = create<PaymentStoreState>((set, get) => ({
  payments: MOCK_PAYMENTS as Payment[],

  getByGroupId: (groupId) =>
    get().payments.filter(p => p.groupId === groupId && !p.isDeleted),

  addPayment: (payment) => set(s => ({ payments: [...s.payments, payment] })),
}));
