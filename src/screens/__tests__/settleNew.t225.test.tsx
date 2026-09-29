import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import SettleNewScreen from '@/app/settle/new';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import type { CurrencyCode } from '@/src/constants/currencies';
import type { Expense, Group, Payment, User } from '@/src/types/models';

/**
 * T-225 (PO 2026-09-29): Saldar va contra lo que YO le debo a esa persona, sin
 * compensar con lo que ella me debe. En un grupo se puede pagar una parte;
 * desde Amigos es el total, un pago por cada grupo compartido.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

const YO   = { id: 'yo',   name: 'Yo'   } as User;
const ANA  = { id: 'ana',  name: 'Ana'  } as User;
const BETO = { id: 'beto', name: 'Beto' } as User;

const grupo = (id: string, memberIds: string[], over: Partial<Group> = {}): Group => ({
  id, name: `Grupo ${id}`, memberIds, currency: 'ARS', miembros: {},
  createdAt: 0, createdById: memberIds[0], updatedAt: 0, isDeleted: false, ...over,
} as Group);

let n = 0;
const gasto = (
  groupId: string, paidById: string, partes: Record<string, number>, currency: CurrencyCode = 'ARS',
): Expense => {
  n++;
  return {
    id: `e${n}`, groupId, description: 'x', currency, paidById, splitMode: 'custom',
    amount: Object.values(partes).reduce((s, x) => s + x, 0),
    splits: Object.entries(partes).map(([userId, amount]) => ({ userId, amount, isPaid: false })),
    category: 'other', date: 0, createdAt: 0, createdById: paidById, updatedAt: 0, isDeleted: false,
  } as unknown as Expense;
};

/** Caso del PO en menor unidad: debo 6.000 a Ana y Ana me debe 20.000. */
const casoDelPO = () => [
  gasto('g1', 'yo',  { yo: 2_000_000, ana: 2_000_000 }),
  gasto('g1', 'ana', { yo: 600_000,   ana: 600_000 }),
];

const pagosGuardados = () => usePaymentStore.getState().payments;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { groupId: 'g1' };
  useAuthStore.setState({ currentUser: YO });
  useUserStore.setState({ users: [YO, ANA, BETO] });
  useGroupStore.setState({ groups: [grupo('g1', ['yo', 'ana'])] });
  useExpenseStore.setState({ expenses: casoDelPO() });
  usePaymentStore.setState({ payments: [] });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
});

describe('Saldar dentro de un grupo: contra lo que le debo, sin compensar', () => {
  it('caso del PO: Yo→Ana sugiere 6.000 aunque Ana me deba 20.000 (antes sugería 0)', () => {
    const r = render(<SettleNewScreen />);
    expect(r.getByDisplayValue(/6\.000/)).toBeTruthy();
    expect(r.getByTestId('settle-outstanding')).toHaveTextContent(/6\.000/);
  });

  it('caso del PO visto por Ana: Ana→Yo sugiere 20.000', () => {
    useAuthStore.setState({ currentUser: ANA });
    const r = render(<SettleNewScreen />);
    expect(r.getByDisplayValue(/20\.000/)).toBeTruthy();
  });

  it('parcial permitido; más que lo que le debo, no', () => {
    const r = render(<SettleNewScreen />);
    const guardar = () => r.getByTestId('settle-save');
    const deshabilitado = () => guardar().props.accessibilityState?.disabled ?? guardar().props.disabled;

    fireEvent.changeText(r.getByDisplayValue(/6\.000/), '2000');
    expect(deshabilitado()).toBeFalsy();

    fireEvent.changeText(r.getByDisplayValue('2.000'), '7000');
    expect(deshabilitado()).toBe(true);
  });

  it('con deudas en las dos direcciones no dice «todo saldado» aunque el neto sea cero', () => {
    useExpenseStore.setState({ expenses: [
      gasto('g1', 'yo',  { yo: 50_000, ana: 50_000 }),
      gasto('g1', 'ana', { yo: 50_000, ana: 50_000 }),
    ] });
    const r = render(<SettleNewScreen />);
    expect(r.queryByText('settle.all_settled')).toBeNull();
    expect(r.getByDisplayValue(/500/)).toBeTruthy();
  });

  it('modo «todo»: dos acreedores, cada uno por lo que le debo, aunque mi neto sea a favor', () => {
    useGroupStore.setState({ groups: [grupo('g1', ['yo', 'ana', 'beto'])] });
    useExpenseStore.setState({ expenses: [
      gasto('g1', 'ana',  { yo: 30_000,  ana: 30_000 }),
      gasto('g1', 'beto', { yo: 50_000,  beto: 50_000 }),
      gasto('g1', 'yo',   { yo: 150_000, ana: 150_000 }),
    ] });
    const r = render(<SettleNewScreen />);

    fireEvent.press(r.getByTestId('settle-mode-all'));
    fireEvent.press(r.getByTestId('settle-save'));

    const pagos = pagosGuardados().map(p => ({ to: p.toUserId, amount: p.amount, groupId: p.groupId }));
    expect(pagos).toEqual(expect.arrayContaining([
      { to: 'beto', amount: 50_000, groupId: 'g1' },
      { to: 'ana',  amount: 30_000, groupId: 'g1' },
    ]));
    expect(pagos).toHaveLength(2);
  });
});

describe('Saldar desde Amigos: el total, un pago por grupo compartido', () => {
  beforeEach(() => {
    mockParams = { toId: 'ana' };
    useGroupStore.setState({ groups: [
      grupo('g1', ['yo', 'ana']),
      grupo('g2', ['yo', 'ana', 'beto']),
      grupo('g3', ['yo', 'ana']),
    ] });
    useExpenseStore.setState({ expenses: [
      ...casoDelPO(),                                     // g1: debo 6.000, me debe 20.000
      gasto('g2', 'ana', { yo: 300_000, ana: 300_000 }),  // g2: debo 3.000
      gasto('g3', 'yo',  { yo: 100_000, ana: 100_000 }),  // g3: sólo me debe ella
    ] });
  });

  it('lista cada grupo con lo que le debo y el total; el monto no se edita', () => {
    const r = render(<SettleNewScreen />);
    expect(r.getByTestId('settle-friend-g1')).toHaveTextContent(/6\.000/);
    expect(r.getByTestId('settle-friend-g2')).toHaveTextContent(/3\.000/);
    expect(r.queryByTestId('settle-friend-g3')).toBeNull();
    expect(r.getByTestId('settle-friend-total')).toHaveTextContent(/9\.000/);
    expect(r.queryByTestId('settle-amount')).toBeNull();
    expect(r.queryByTestId('settle-max')).toBeNull();
  });

  it('confirma con un modal antes de guardar; al aceptar, un pago por grupo', () => {
    const alerta = jest.spyOn(Alert, 'alert');
    const r = render(<SettleNewScreen />);

    fireEvent.press(r.getByTestId('settle-save'));
    expect(pagosGuardados()).toHaveLength(0);
    expect(alerta).toHaveBeenCalledTimes(1);

    const botones = alerta.mock.calls[0][2]!;
    botones.find(b => b.style !== 'cancel')!.onPress!();

    const pagos = pagosGuardados().map(p => ({
      groupId: p.groupId, from: p.fromUserId, to: p.toUserId, amount: p.amount, currency: p.currency,
    }));
    expect(pagos).toEqual([
      { groupId: 'g1', from: 'yo', to: 'ana', amount: 600_000, currency: 'ARS' },
      { groupId: 'g2', from: 'yo', to: 'ana', amount: 300_000, currency: 'ARS' },
    ]);
    expect(router.back).toHaveBeenCalled();
  });

  it('cancelar el modal no guarda nada', () => {
    const alerta = jest.spyOn(Alert, 'alert');
    const r = render(<SettleNewScreen />);
    fireEvent.press(r.getByTestId('settle-save'));
    alerta.mock.calls[0][2]!.find(b => b.style === 'cancel')?.onPress?.();
    expect(pagosGuardados()).toHaveLength(0);
  });

  it('cada pago en la moneda de su grupo, sin convertir', () => {
    useGroupStore.setState({ groups: [grupo('g1', ['yo', 'ana']), grupo('g2', ['yo', 'ana'], { currency: 'USD' })] });
    useExpenseStore.setState({ expenses: [...casoDelPO(), gasto('g2', 'ana', { yo: 2_500, ana: 2_500 }, 'USD')] });
    const alerta = jest.spyOn(Alert, 'alert');
    const r = render(<SettleNewScreen />);

    fireEvent.press(r.getByTestId('settle-save'));
    alerta.mock.calls[0][2]!.find(b => b.style !== 'cancel')!.onPress!();

    expect(pagosGuardados().map(p => [p.groupId, p.currency, p.amount])).toEqual([
      ['g1', 'ARS', 600_000],
      ['g2', 'USD', 2_500],
    ]);
  });

  it('un monto que llegue por parámetro se ignora: el total sale de las deudas', () => {
    mockParams = { toId: 'ana', maxAmount: '100', currency: 'ARS' };
    const r = render(<SettleNewScreen />);
    expect(r.getByTestId('settle-friend-total')).toHaveTextContent(/9\.000/);
  });

  it('si no le debo nada en ningún grupo, no se puede guardar', () => {
    useExpenseStore.setState({ expenses: [gasto('g3', 'yo', { yo: 100_000, ana: 100_000 })] });
    const r = render(<SettleNewScreen />);
    const guardar = r.getByTestId('settle-save');
    expect(guardar.props.accessibilityState?.disabled ?? guardar.props.disabled).toBe(true);
    expect(r.getByText('settle.friend_nothing')).toBeTruthy();
  });
});
