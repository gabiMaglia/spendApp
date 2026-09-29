import React from 'react';
import { render } from '@testing-library/react-native';

import UserScreen from '@/app/(tabs)/user';
import { sembrarDatasetRealista, contarNodosHost } from './perfVistasFixtures';

/**
 * T-216 — pregunta 2: nodos host de la pestaña Cuenta. En archivo PROPIO
 * (no junto a las otras 4): `user.tsx` importa `@expo/vector-icons`
 * (Ionicons) directo, que carga fuentes async y — mezclado con otras
 * pantallas en el mismo entorno de test — puede colgar Jest (nota del
 * ticket, ya vista en T-204).
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

describe('T-216 — nodos host: Cuenta', () => {
  it('cuenta los nodos host del árbol montado', () => {
    const r = render(<UserScreen />);
    const nodos = contarNodosHost(r.toJSON());
    console.log('[T-216][nodosHost] Cuenta=%s', nodos);
    // T-154: tope de nodos host tras virtualizar con FlashList (dataset realista T-216).
    expect(nodos).toBeLessThan(120);
  });
});
