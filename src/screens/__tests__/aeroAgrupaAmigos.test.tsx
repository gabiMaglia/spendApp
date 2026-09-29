import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { FlashList } from '@shopify/flash-list';

import FriendsScreen from '@/app/(tabs)/friends';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { useSettingsStore } from '@/src/store/settingsStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { usuario } from '@/src/test-utils/perfVistasFixtures';

/**
 * T-154 (rechazo QA, defectos 1 y 2): Amigos pasó de "un Band compartido
 * envolviendo todos los contactos" a "un Band por FILA" — con Aero eso da
 * un Panel por contacto en vez de UNA tarjeta para todo el bloque. Fix:
 * el ítem de FlashList es el BLOQUE completo (Band con todos los contactos,
 * el JSX original de `ff2c4eb`). Se restaura también `flexGrow: 1`.
 */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/motor/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}),
}));

function seedTresContactos() {
  createSecureStorage('groups').clearAll();
  const u = usuario('u0');
  const contacts = [usuario('c0'), usuario('c1'), usuario('c2')];

  useAuthStore.setState({ currentUser: u, isPro: false });
  useUserStore.setState({ users: [u, ...contacts] });
  useGroupStore.setState({ groups: [] });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
}

describe('T-154 — Amigos: agrupación Aero de bloque único', () => {
  beforeEach(() => {
    seedTresContactos();
  });

  afterEach(() => {
    useSettingsStore.setState({ skin: 'default' });
  });

  it('con Aero, 3 contactos dan exactamente 1 panel (una sola tarjeta para el bloque)', () => {
    useSettingsStore.setState({ skin: 'aero' });
    const r = render(<FriendsScreen />);
    expect(r.getAllByTestId('skin-panel')).toHaveLength(1);
  });

  it('el contentContainerStyle de la lista incluye flexGrow: 1 (centrado del estado vacío)', () => {
    const r = render(<FriendsScreen />);
    const lista = r.UNSAFE_getByType(FlashList as any);
    const flat = StyleSheet.flatten(lista.props.contentContainerStyle);
    expect(flat.flexGrow).toBe(1);
  });
});
