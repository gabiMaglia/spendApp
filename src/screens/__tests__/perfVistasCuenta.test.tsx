import React from 'react';
import { render } from '@testing-library/react-native';

import UserScreen from '@/app/(tabs)/user';
import { sembrarDatasetRealista, contarNodosHost } from '@/src/test-utils/perfVistasFixtures';

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
  it('cuenta los nodos host del árbol montado (medición, sin tope — T-154: fuera de alcance)', () => {
    // T-154 (decisión del PO/orquestador, 2026-09-29): Cuenta queda FUERA
    // del alcance de la migración a FlashList — no es una lista de datos
    // que crezca con el uso (como Actividad/Grupos/Amigos), es una pantalla
    // de AJUSTES: perfil, plan, preferencias. Virtualizarla no tiene
    // sentido — no hay nada que reciclar. Se deja la medición (para que
    // T-216 siga teniendo el dato si hace falta comparar) pero sin `expect`
    // de tope: no hay ningún cambio de producto pendiente que este número
    // deba gatillar.
    const r = render(<UserScreen />);
    const nodos = contarNodosHost(r.toJSON());
    console.log('[T-216][nodosHost] Cuenta=%s (sin tope, fuera de alcance T-154)', nodos);
  });
});
