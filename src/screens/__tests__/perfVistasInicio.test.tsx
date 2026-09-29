import React from 'react';
import { render } from '@testing-library/react-native';

import PersonalScreen from '@/app/(tabs)/index';
import { sembrarDatasetRealista, contarNodosHost } from '@/src/test-utils/perfVistasFixtures';

/**
 * T-216 — pregunta 2: nodos host que pinta la pestaña Inicio con datos
 * realistas (8 grupos, 200 gastos, 30 amigos). Un archivo por pestaña a
 * propósito (ver `perfVistasFixtures.ts`).
 */
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

describe('T-216 — nodos host: Inicio', () => {
  it('cuenta los nodos host del árbol montado', () => {
    const r = render(<PersonalScreen />);
    const nodos = contarNodosHost(r.toJSON());
    console.log('[T-216][nodosHost] Inicio=%s', nodos);
    // T-154: tope de nodos host tras virtualizar con FlashList (dataset realista T-216).
    expect(nodos).toBeLessThan(90);
  });
});
