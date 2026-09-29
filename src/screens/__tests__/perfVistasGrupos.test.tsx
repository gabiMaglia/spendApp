import React from 'react';
import { render } from '@testing-library/react-native';

import GroupsScreen from '@/app/(tabs)/groups';
import { sembrarDatasetRealista, contarNodosHost } from './perfVistasFixtures';

/** T-216 — pregunta 2: nodos host de la pestaña Grupos (8 grupos). */
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

describe('T-216 — nodos host: Grupos', () => {
  it('cuenta los nodos host del árbol montado', () => {
    const r = render(<GroupsScreen />);
    const nodos = contarNodosHost(r.toJSON());
    console.log('[T-216][nodosHost] Grupos=%s', nodos);
    expect(nodos).toBeGreaterThan(0);
  });
});
