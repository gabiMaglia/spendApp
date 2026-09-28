import React from 'react';
import { render } from '@testing-library/react-native';
import ActivityScreen from '@/app/(tabs)/activity';
import { useAuthStore } from '@/src/store/authStore';
import type { User } from '@/src/types/models';

/**
 * PO 2026-09-27: en Actividad la barra de búsqueda va DEBAJO de las pestañas
 * (Todos / Personal / grupos), no arriba.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/motor/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

const ANA = { id: 'ana', name: 'Ana' } as User;

describe('Actividad: orden de la búsqueda', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUser: ANA } as any);
  });

  it('las pestañas se renderizan antes que la barra de búsqueda', () => {
    const r = render(<ActivityScreen />);
    const arbol = JSON.stringify(r.toJSON());
    const pestanas = arbol.indexOf('activity.filter_all');
    const busqueda = arbol.indexOf('activity-search');
    expect(pestanas).toBeGreaterThan(-1);
    expect(busqueda).toBeGreaterThan(-1);
    expect(pestanas).toBeLessThan(busqueda);
  });
});
