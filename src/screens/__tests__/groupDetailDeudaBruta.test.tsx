import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import GroupDetailScreen from '@/app/groups/[id]';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { formatMoney } from '@/src/constants/currencies';
import type { Expense, Group, User } from '@/src/types/models';

/**
 * T-225 (PO 2026-09-29) — detalle de grupo con la deuda sin compensar.
 *
 * Caso del PO: un grupo con Ana, cuatro gastos a favor (200) y uno en contra
 * (60). Antes se veía «te deben 140» y los 60 que debía desaparecían. Ahora:
 * arriba Te deben 200 · Debés 60; abajo, el balance neto +140; Saldar visible
 * porque debo algo; y los avisos de expulsar/salir dicen las dos direcciones.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: 'g1' }),
}));

const YO  = { id: 'yo',  name: 'Yo',  isDeleted: false } as User;
const ANA = { id: 'ana', name: 'Ana', isDeleted: false } as User;

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['yo', 'ana'], currency: 'ARS',
  miembros: { yo: { estado: 'in', at: 0 }, ana: { estado: 'in', at: 1 } },
  createdAt: 0, createdById: 'yo', updatedAt: 0, isDeleted: false, ...over,
} as Group);

const gasto = (id: string, pagador: string, total: number, descripcion = id): Expense => ({
  id, groupId: 'g1', description: descripcion, amount: total, currency: 'ARS',
  paidById: pagador, splitMode: 'equal',
  splits: [{ userId: 'yo', amount: total / 2 }, { userId: 'ana', amount: total / 2 }],
  category: 'food', date: 0, createdAt: 0, createdById: pagador, updatedAt: 0, isDeleted: false,
} as Expense);

/** Cuatro de 100 que pagué yo (Ana me debe 50 de cada uno) y uno de 120 que pagó Ana (le debo 60). */
const casoDelPO = (): Expense[] => [
  gasto('a1', 'yo', 10_000, 'Cena 1'), gasto('a2', 'yo', 10_000), gasto('a3', 'yo', 10_000),
  gasto('a4', 'yo', 10_000), gasto('b1', 'ana', 12_000, 'Nafta'),
];

const monto = (r: ReturnType<typeof render>, id: string) => r.UNSAFE_getByProps({ id }).props;
const lineaMeDebe = (name: string, minor: number) =>
  `group_detail.debt_owes_you(${JSON.stringify({ name, amounts: formatMoney(minor, 'ARS') })})`;
const lineaLeDebo = (name: string, minor: number) =>
  `group_detail.debt_you_owe(${JSON.stringify({ name, amounts: formatMoney(minor, 'ARS') })})`;

beforeEach(() => {
  createSecureStorage('groups').clearAll();
  createSecureStorage('groupkeys').clearAll();
  useAuthStore.setState({ currentUser: YO });
  useGroupStore.setState({ groups: [grupo()] });
  useUserStore.setState({ users: [YO, ANA] });
  useExpenseStore.setState({ expenses: casoDelPO() });
  usePaymentStore.setState({ payments: [] });
  useGroupKeyStore.setState({ keys: [] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => { jest.restoreAllMocks(); });

describe('detalle de grupo: Te deben / Debés arriba, balance neto abajo', () => {
  it('caso del PO: arriba Te deben 200 · Debés 60, sin compensar', () => {
    const r = render(<GroupDetailScreen />);
    expect(monto(r, 'groupDetail.owedToYou:g1')).toMatchObject({ minor: 20_000, code: 'ARS' });
    expect(monto(r, 'groupDetail.youOwe:g1')).toMatchObject({ minor: 6_000, code: 'ARS' });
    expect(r.getByText('groups.stat_owed_to_you')).toBeTruthy();
    expect(r.getByText('groups.stat_you_owe')).toBeTruthy();
  });

  it('caso del PO: abajo el balance neto es +140 (Te deben − Debés)', () => {
    const r = render(<GroupDetailScreen />);
    expect(r.getByTestId('group-net-balance')).toBeTruthy();
    expect(r.getByText('group_detail.balance_label')).toBeTruthy();
    expect(monto(r, 'groupDetail.balance:g1')).toMatchObject({ minor: 14_000, code: 'ARS', prefix: '' });
  });

  it('el balance neto negativo lleva el signo', () => {
    useExpenseStore.setState({ expenses: [gasto('b1', 'ana', 12_000)] });
    const r = render(<GroupDetailScreen />);
    expect(monto(r, 'groupDetail.balance:g1')).toMatchObject({ minor: -6_000, prefix: '-' });
  });

  it('sin movimientos: los dos casilleros y el balance en cero', () => {
    useExpenseStore.setState({ expenses: [] });
    const r = render(<GroupDetailScreen />);
    expect(monto(r, 'groupDetail.owedToYou:g1').minor).toBe(0);
    expect(monto(r, 'groupDetail.youOwe:g1').minor).toBe(0);
    expect(monto(r, 'groupDetail.balance:g1').minor).toBe(0);
  });

  it('orden: widget → timeline → balance → pedido de salida → traspasar', () => {
    useGroupStore.setState({ groups: [grupo({
      createdById: 'ana',
      leaveRequest: { userId: 'ana', plan: [], requestedAt: 0, approvals: {} } as unknown as Group['leaveRequest'],
    })] });
    const arbol = JSON.stringify(render(<GroupDetailScreen />).toJSON());
    const posiciones = [
      'groups.stat_owed_to_you', 'Cena 1', '"group-net-balance"', 'leave.pending', '"traspaso-manual-btn"',
    ].map(marca => arbol.indexOf(marca));
    expect(posiciones.every(p => p >= 0)).toBe(true);
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
  });

  it('el balance grande de antes ya no está arriba', () => {
    const r = render(<GroupDetailScreen />);
    expect(r.queryByText('group_detail.owe_you')).toBeNull();
    expect(r.queryByText('group_detail.you_owe_short')).toBeNull();
  });
});

describe('Saldar = si DEBO algo (T-225)', () => {
  it('debo 60 aunque el neto sea +140: Saldar visible', () => {
    const r = render(<GroupDetailScreen />);
    expect(r.getByTestId('settle-debts')).toBeTruthy();
  });

  it('sólo me deben: Saldar oculto', () => {
    useExpenseStore.setState({ expenses: [gasto('a1', 'yo', 10_000)] });
    const r = render(<GroupDetailScreen />);
    expect(r.queryByTestId('settle-debts')).toBeNull();
  });
});

describe('expulsar avisa las dos direcciones (T-225)', () => {
  it('dice lo que Ana me debe y lo que yo le debo, además del aviso de siempre', () => {
    const r = render(<GroupDetailScreen />);
    fireEvent.press(r.getByTestId('member-ana'));

    const [titulo, cuerpo] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(titulo).toContain('group_detail.expel_title');
    expect(cuerpo).toContain('group_detail.expel_body_with_balance');
    expect(cuerpo).toContain(lineaMeDebe('Ana', 20_000));
    expect(cuerpo).toContain(lineaLeDebo('Ana', 6_000));
  });

  it('deudas cruzadas que se compensan (neto 0): igual avisa las dos', () => {
    useExpenseStore.setState({ expenses: [gasto('a1', 'yo', 12_000), gasto('b1', 'ana', 12_000)] });
    const r = render(<GroupDetailScreen />);
    fireEvent.press(r.getByTestId('member-ana'));

    const [, cuerpo] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(cuerpo).toContain(lineaMeDebe('Ana', 6_000));
    expect(cuerpo).toContain(lineaLeDebo('Ana', 6_000));
  });

  it('sin saldo en ninguna dirección: el texto de hoy, sin líneas de deuda', () => {
    useExpenseStore.setState({ expenses: [] });
    const r = render(<GroupDetailScreen />);
    fireEvent.press(r.getByTestId('member-ana'));

    const [, cuerpo] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(cuerpo).toBe(`group_detail.expel_body(${JSON.stringify({ name: 'Ana' })})`);
  });
});

describe('salir con saldo avisa a quién le debo y quién me debe (T-225)', () => {
  const salir = (r: ReturnType<typeof render>) => {
    fireEvent.press(r.getByTestId('group-options'));
    fireEvent.press(r.getByText('group_detail.leave_group'));
  };
  const botones = () => ((Alert.alert as jest.Mock).mock.calls.at(-1)![2] as { text: string }[]).map(b => b.text);

  beforeEach(() => { useGroupStore.setState({ groups: [grupo({ createdById: 'ana' })] }); });

  it('caso del PO: bloquea y dice los 200 que me debe Ana y los 60 que le debo', () => {
    salir(render(<GroupDetailScreen />));

    const [titulo, cuerpo] = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
    expect(titulo).toBe('group_detail.leave_blocked_title');
    expect(cuerpo).toContain('group_detail.leave_needs_settle');
    expect(cuerpo).toContain(lineaMeDebe('Ana', 20_000));
    expect(cuerpo).toContain(lineaLeDebo('Ana', 6_000));
    expect(botones()).toEqual(['common.cancel', 'group_detail.settle_debts', 'leave.title']);
  });

  it('deudas cruzadas con neto 0: ya no sale libre — debo algo', () => {
    useExpenseStore.setState({ expenses: [gasto('a1', 'yo', 12_000), gasto('b1', 'ana', 12_000)] });
    salir(render(<GroupDetailScreen />));

    const [titulo, cuerpo] = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
    expect(titulo).toBe('group_detail.leave_blocked_title');
    expect(cuerpo).toContain(lineaLeDebo('Ana', 6_000));
    // Sin neto no hay nada que repartir: la pantalla de absorción no podría
    // cerrar el plan, así que no se ofrece; queda Saldar.
    expect(botones()).toEqual(['common.cancel', 'group_detail.settle_debts']);
  });

  it('sin saldo en ninguna dirección: el aviso de hoy', () => {
    useExpenseStore.setState({ expenses: [] });
    salir(render(<GroupDetailScreen />));

    expect(Alert.alert).toHaveBeenLastCalledWith(
      'group_detail.leave_title', 'group_detail.leave_body', expect.anything(),
    );
  });
});
