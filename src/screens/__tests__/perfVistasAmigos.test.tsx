import React from 'react';
import { render } from '@testing-library/react-native';

import FriendsScreen from '@/app/(tabs)/friends';
import { sembrarDatasetRealista, contarNodosHost } from './perfVistasFixtures';

/** T-216 — pregunta 2: nodos host de la pestaña Amigos (20 contactos). */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/motor/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}),
}));

beforeEach(() => {
  sembrarDatasetRealista();
});

describe('T-216 — nodos host: Amigos', () => {
  it('cuenta los nodos host del árbol montado', () => {
    const r = render(<FriendsScreen />);
    const nodos = contarNodosHost(r.toJSON());
    console.log('[T-216][nodosHost] Amigos=%s', nodos);
    // T-154: tope de nodos host tras virtualizar con FlashList (dataset realista T-216).
    expect(nodos).toBeLessThan(120);
  });
});
