import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import FriendsScreen from '@/app/(tabs)/friends';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { isBlocked } from '@/src/sync/blockedPeers';
import type { User } from '@/src/types/models';

/**
 * T-180 (7.1), fila B1/B5: la pantalla de contactos ofrece Bloquear/
 * Desbloquear y muestra la insignia "Bloqueado" en un contacto bloqueado.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  useFocusEffect: jest.fn(),
}));

const YO   = { id: 'yo',   name: 'Yo',   isDeleted: false } as User;
const BETO = { id: 'beto', name: 'Beto', isDeleted: false } as User;

beforeEach(() => {
  createSecureStorage('users').clearAll();
  useAuthStore.setState({ currentUser: YO });
  useUserStore.setState({ users: [YO, BETO] });
  useGroupStore.setState({ groups: [] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _b, buttons) => {
    // Confirma el botón destructivo/principal automáticamente, como si el
    // usuario tocara "Bloquear".
    const boton = buttons?.find(b => b.style === 'destructive') ?? buttons?.[buttons.length - 1];
    boton?.onPress?.();
  });
});

afterEach(() => { jest.restoreAllMocks(); });

describe('T-180 — bloquear/desbloquear desde la lista de contactos', () => {
  it('un contacto sin bloquear ofrece "Bloquear"; al tocarlo, isBlocked pasa a true', () => {
    const { getAllByText } = render(<FriendsScreen />);

    expect(isBlocked(BETO.id)).toBe(false);
    fireEvent.press(getAllByText('contacts.block')[0]);

    expect(isBlocked(BETO.id)).toBe(true);
  });

  it('un contacto bloqueado muestra la insignia "Bloqueado" y ofrece "Desbloquear"', () => {
    const { getByText, queryByText, rerender } = render(<FriendsScreen />);

    fireEvent.press(getByText('contacts.block'));
    rerender(<FriendsScreen />);

    expect(queryByText('contacts.blocked_badge')).toBeTruthy();
    expect(queryByText('contacts.unblock')).toBeTruthy();
    expect(queryByText('contacts.block')).toBeNull();
  });

  it('desbloquear revierte isBlocked y la insignia desaparece', () => {
    const { getByText, queryByText, rerender } = render(<FriendsScreen />);

    fireEvent.press(getByText('contacts.block'));
    rerender(<FriendsScreen />);
    fireEvent.press(getByText('contacts.unblock'));
    rerender(<FriendsScreen />);

    expect(isBlocked(BETO.id)).toBe(false);
    expect(queryByText('contacts.blocked_badge')).toBeNull();
  });
});
