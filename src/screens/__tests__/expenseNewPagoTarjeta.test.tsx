import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import NewExpenseScreen from '@/app/expense/new';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useSettingsStore } from '@/src/store/settingsStore';
import type { Group, User } from '@/src/types/models';

/**
 * T-210 (PO 2026-09-28) — en Clásico, «Pagó» y «Cómo se divide» iban de borde a
 * borde (rompían con el resto de la pantalla, que ya es de tarjetas cerradas).
 * Ahora van dentro de `TarjetaClasica`, igual que Repetir/descripción. El link
 * «pagaron varios» vive DENTRO de la tarjeta de pago (pie), no suelto afuera.
 * Aero conserva su render actual — no usa `TarjetaClasica`.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

let mockSearchParams: Record<string, string | undefined> = { groupId: 'g1' };
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => mockSearchParams,
}));

const ANA = { id: 'ana', name: 'Ana' } as User;
const BETO = { id: 'beto', name: 'Beto' } as User;

const grupo = (): Group => ({
  id: 'g1', name: 'Asado', memberIds: ['ana', 'beto'], currency: 'ARS',
  miembros: {},
  createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false,
} as Group);

beforeEach(() => {
  mockSearchParams = { groupId: 'g1' };
  useAuthStore.setState({ currentUser: ANA, isPro: false });
  useGroupStore.setState({ groups: [grupo()] });
  useUserStore.setState({ users: [ANA, BETO] });
  useExpenseStore.setState({ expenses: [] });
  useSettingsStore.setState({ skin: 'default' });
});

describe('T-210 — Clásico: Pago y Reparto como tarjetas cerradas', () => {
  it('«Pagó» se renderiza dentro de TarjetaClasica (tarjeta-pago)', () => {
    const { getByTestId } = render(<NewExpenseScreen />);
    const tarjeta = getByTestId('tarjeta-pago');
    expect(tarjeta).toBeTruthy();
  });

  it('«Cómo se divide» se renderiza dentro de TarjetaClasica (tarjeta-reparto)', () => {
    const { getByTestId } = render(<NewExpenseScreen />);
    const tarjeta = getByTestId('tarjeta-reparto');
    expect(tarjeta).toBeTruthy();
  });

  it('el link «pagaron varios» está DENTRO de la tarjeta de pago', () => {
    const { getByTestId, getByText } = render(<NewExpenseScreen />);
    const tarjeta = getByTestId('tarjeta-pago');
    const link = getByText('payers.multiple');
    // Si el link no fuera descendiente de la tarjeta, `within` lo encontraría
    // igual acá — así que verificamos ascendiendo desde el link.
    expect(tarjeta).toContainElement(link);
  });

  it('al tocar «pagaron varios» aparece PayerSplitter dentro de la misma tarjeta', () => {
    const { getByTestId, getByText, queryByText } = render(<NewExpenseScreen />);

    expect(queryByText('payers.title')).toBeNull();

    fireEvent.press(getByText('payers.multiple'));

    const tarjeta = getByTestId('tarjeta-pago');
    const splitterTitle = getByText('payers.title');
    expect(tarjeta).toContainElement(splitterTitle);
  });

  it('en Aero no hay TarjetaClasica', () => {
    useSettingsStore.setState({ skin: 'aero' });
    const { queryByTestId } = render(<NewExpenseScreen />);
    expect(queryByTestId('tarjeta-pago')).toBeNull();
    expect(queryByTestId('tarjeta-reparto')).toBeNull();
  });
});
