import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { FlashList } from '@shopify/flash-list';

import GroupsScreen from '@/app/(tabs)/groups';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { useSettingsStore } from '@/src/store/settingsStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { usuario, grupo } from '@/src/test-utils/perfVistasFixtures';

/**
 * T-154 (rechazo QA, defectos 1 y 2): Grupos pasó de "un Band compartido
 * envolviendo todas las filas" a "un Band por FILA" — con Aero eso da un
 * Panel por grupo en vez de UNA tarjeta para todo el bloque. Fix: el ítem
 * de FlashList es el BLOQUE completo (Band con todos los grupos, el JSX
 * original de `ff2c4eb`) — con un único bloque, un único ítem; la ganancia
 * de FlashList acá es de escala futura, no de este dataset. Se restaura
 * también `flexGrow: 1`.
 */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/motor/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}),
}));

function seedTresGrupos() {
  createSecureStorage('groups').clearAll();
  const u = usuario('u0');
  const groups = [grupo('g0', ['u0']), grupo('g1', ['u0']), grupo('g2', ['u0'])];

  useAuthStore.setState({ currentUser: u, isPro: false });
  useUserStore.setState({ users: [u] });
  useGroupStore.setState({ groups });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
}

describe('T-154 — Grupos: agrupación Aero de bloque único', () => {
  beforeEach(() => {
    seedTresGrupos();
  });

  afterEach(() => {
    useSettingsStore.setState({ skin: 'default' });
  });

  it('con Aero, 3 grupos dan 2 paneles (1 del header StatGrid + 1 del bloque, no 1 por fila)', () => {
    // GroupsSummaryStats (StatGrid → Band) ya pone SU propio panel, ajeno a
    // este bug — se verificó por separado (1 grupo → 2 paneles: header+bloque;
    // 0 filas extra por el header no cambia con la cantidad de grupos). Lo que
    // este test cubre es que el BLOQUE de grupos siga siendo UN panel para
    // cualquier cantidad de filas, no uno por fila.
    useSettingsStore.setState({ skin: 'aero' });
    const r = render(<GroupsScreen />);
    expect(r.getAllByTestId('skin-panel')).toHaveLength(2);
  });

  it('el contentContainerStyle de la lista incluye flexGrow: 1 (centrado del estado vacío)', () => {
    const r = render(<GroupsScreen />);
    const lista = r.UNSAFE_getByType(FlashList as any);
    const flat = StyleSheet.flatten(lista.props.contentContainerStyle);
    expect(flat.flexGrow).toBe(1);
  });
});
