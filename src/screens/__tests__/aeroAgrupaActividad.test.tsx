import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { FlashList } from '@shopify/flash-list';

import ActivityScreen from '@/app/(tabs)/activity';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useSettingsStore } from '@/src/store/settingsStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { usuario, grupo, gasto } from './perfVistasFixtures';

/**
 * T-154 (3ra vuelta — decisión del orquestador): el ítem = SECCIÓN completa
 * (2da vuelta) no dejaba virtualizar dentro de "Antes" — la única sección
 * que puede crecer sin límite. Vuelve a ítem = FILA, pero con el panel Aero
 * SEGMENTADO por fila (`Panel.tsx`, prop `segmento`): varias filas seguidas
 * arman UNA tarjeta continua (radio sólo en las puntas, divisor entre
 * filas), no una tarjeta por fila. `flexGrow: 1` se mantiene restaurado.
 */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/motor/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}),
}));

function seedDosSecciones() {
  createSecureStorage('groups').clearAll();
  const u = usuario('u0');
  const g = grupo('g0', ['u0']);
  const hoy = Date.now();
  const viejo = Date.now() - 65 * 24 * 60 * 60 * 1000; // > 1 día → sección "Antes"
  const expenses = [
    { ...gasto('e0', g.id, g.memberIds, 'u0'), date: hoy },
    { ...gasto('e1', g.id, g.memberIds, 'u0'), date: hoy },
    { ...gasto('e2', g.id, g.memberIds, 'u0'), date: hoy },
    { ...gasto('e3', g.id, g.memberIds, 'u0'), date: viejo },
    { ...gasto('e4', g.id, g.memberIds, 'u0'), date: viejo },
    { ...gasto('e5', g.id, g.memberIds, 'u0'), date: viejo },
  ];

  useAuthStore.setState({ currentUser: u, isPro: false });
  useUserStore.setState({ users: [u] });
  useGroupStore.setState({ groups: [g] });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
  useExpenseStore.setState({ expenses });
  usePaymentStore.setState({ payments: [] });
  usePersonalStore.setState({ entries: [], budget: usePersonalStore.getState().budget });
}

describe('T-154 — Actividad: agrupación Aero por sección', () => {
  beforeEach(() => {
    seedDosSecciones();
  });

  afterEach(() => {
    useSettingsStore.setState({ skin: 'default' });
  });

  it('con Aero, 2 secciones de 3 filas dan 2 primera + 2 media + 2 ultima + 4 divisores', () => {
    useSettingsStore.setState({ skin: 'aero' });
    const r = render(<ActivityScreen />);
    expect(r.getAllByTestId('skin-panel-primera')).toHaveLength(2);
    expect(r.getAllByTestId('skin-panel-media')).toHaveLength(2);
    expect(r.getAllByTestId('skin-panel-ultima')).toHaveLength(2);
    expect(r.getAllByTestId('band-stack-divisor')).toHaveLength(4);
  });

  it('el contentContainerStyle de la lista incluye flexGrow: 1 (centrado del estado vacío)', () => {
    const r = render(<ActivityScreen />);
    const lista = r.UNSAFE_getByType(FlashList as any);
    const flat = StyleSheet.flatten(lista.props.contentContainerStyle);
    expect(flat.flexGrow).toBe(1);
  });
});
