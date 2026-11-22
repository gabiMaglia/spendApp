import React from 'react';
import { render } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';

import { EventRow } from '@/src/screens/activity/components/EventRow';
import { ActivityFilterTabs } from '@/src/screens/activity/components/ActivityFilterTabs';
import { PERSONAL_ACTIVITY_KEY, type ActivityKind } from '@/src/store/selectors';
import type { Expense, Payment, PersonalEntry } from '@/src/types/models';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const gasto = (over: Partial<Expense> = {}) => ({
  id: 'e1', groupId: 'g1', description: 'Carne', amount: 1000, currency: 'ARS',
  paidById: 'ana', splitMode: 'equal', splits: [], category: 'food',
  date: 1, createdAt: 1, createdById: 'ana', updatedAt: 1, isDeleted: false, ...over,
}) as Expense;

const fila = (event: ActivityKind) => render(
  <EventRow event={event} trust="verificado" getUserName={id => id} currentUserId="ana" onRestore={() => {}} />,
);

describe('EventRow — íconos propios (T-294)', () => {
  it('gasto creado: cubo de su categoría y sin sello', () => {
    const r = fila({ kind: 'expense_added', expense: gasto({ category: 'transport' }), groupName: 'Viaje' });
    expect(r.getByTestId('icono-categoria-transport-a')).toBeTruthy();
    expect(r.queryByTestId(/evento-sello-/)).toBeNull();
  });

  it('gasto borrado: cubo apagado de su categoría + sello «tacho»', () => {
    const r = fila({ kind: 'expense_deleted', expense: gasto({ category: 'shopping' }), groupName: 'Viaje' });
    expect(r.getByTestId('icono-categoria-shopping-a')).toBeTruthy();
    expect(r.getByTestId('evento-sello-tacho')).toBeTruthy();
    expect(r.getByTestId('evento-icono-apagado')).toBeTruthy();
  });

  it('gasto restaurado: cubo de su categoría + sello «deshacer»', () => {
    const r = fila({ kind: 'expense_restored', expense: gasto({ category: 'health' }), groupName: 'Viaje', restoredByName: 'Ana' } as ActivityKind);
    expect(r.getByTestId('icono-categoria-health-a')).toBeTruthy();
    expect(r.getByTestId('evento-sello-deshacer')).toBeTruthy();
  });

  it('un gasto sin categoría resoluble cae a «other»', () => {
    const r = fila({ kind: 'expense_added', expense: gasto({ category: 'inventada' as any }), groupName: 'Viaje' });
    expect(r.getByTestId('icono-categoria-other-a')).toBeTruthy();
  });

  it('pago: cubo con el glifo «saldar» y sin sello', () => {
    const payment = { id: 'p', groupId: 'g1', fromUserId: 'ana', toUserId: 'bob', amount: 5, currency: 'ARS', date: 1 } as Payment;
    const r = fila({ kind: 'payment_made', payment, groupName: 'Viaje' });
    expect(r.getByTestId('icono-categoria-saldar-a')).toBeTruthy();
    expect(r.queryByTestId(/evento-sello-/)).toBeNull();
  });

  it('entrada personal: ingreso usa «income»; gasto personal, su categoría', () => {
    const base = { description: 'x', amount: 5, currency: 'ARS', date: 1, createdAt: 1 };
    const ing = fila({ kind: 'personal_entry', entry: { ...base, id: 'a', kind: 'income', category: 'salary' } as unknown as PersonalEntry } as ActivityKind);
    expect(ing.getByTestId('icono-categoria-income-a')).toBeTruthy();
    const gas = fila({ kind: 'personal_entry', entry: { ...base, id: 'b', kind: 'expense', category: 'food' } as unknown as PersonalEntry } as ActivityKind);
    expect(gas.getByTestId('icono-categoria-food-a')).toBeTruthy();
  });
});

describe('ActivityFilterTabs — glifos propios (T-294)', () => {
  it('dibuja un glifo de trazo por filtro', () => {
    const r = render(<ActivityFilterTabs allGroupNames={['__all__', PERSONAL_ACTIVITY_KEY, 'Viaje']} value="__all__" onChange={() => {}} />);
    expect(r.getByTestId('icono-glifo-todos-trazo')).toBeTruthy();
    expect(r.getByTestId('icono-glifo-personal-trazo')).toBeTruthy();
    expect(r.getByTestId('icono-glifo-amigos-trazo')).toBeTruthy();
  });
});

describe('guard: sin Ionicons para estos íconos', () => {
  it.each(['EventRow.tsx', 'ActivityFilterTabs.tsx'])('%s no importa Ionicons', f => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', f), 'utf8');
    expect(src).not.toMatch(/Ionicons/);
  });
});
