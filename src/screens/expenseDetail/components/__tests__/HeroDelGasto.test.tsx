import React from 'react';
import { render } from '@testing-library/react-native';

import { HeroDelGasto } from '@/src/screens/expenseDetail/components/HeroDelGasto';
import { useSettingsStore } from '@/src/store/settingsStore';
import type { Expense } from '@/src/types/models';

const gasto = {
  id: 'g1', description: 'Supermercado', amount: 12400, currency: 'ARS', category: 'food',
  createdById: 'u1',
} as unknown as Expense;

describe('HeroDelGasto: mármol según skin (PO 2026-11-22)', () => {
  afterEach(() => { useSettingsStore.setState({ skin: 'default' }); });

  const hero = () => render(
    <HeroDelGasto expense={gasto} dateStr="22 nov" marca={undefined} nombreDe={(u) => u} />,
  );

  it('Aero: la tarjeta héroe va lisa, sin fondo de mármol', () => {
    useSettingsStore.setState({ skin: 'aero' });
    const r = hero();
    expect(r.queryByTestId('fondo-marmol', { includeHiddenElements: true })).toBeNull();
    expect(r.getByText('Supermercado')).toBeTruthy();
  });

  it('Clásico: conserva el fondo de mármol', () => {
    const r = hero();
    expect(r.getByTestId('fondo-marmol', { includeHiddenElements: true })).toBeTruthy();
    expect(r.getByText('Supermercado')).toBeTruthy();
  });
});
