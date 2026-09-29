import React from 'react';
import { render } from '@testing-library/react-native';

import FriendsScreen from '@/app/(tabs)/friends';
import { sembrarDatasetRealista, contarNodosHost } from '@/src/test-utils/perfVistasFixtures';

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
    // T-154 (2da vuelta, tras rechazo QA — engram/qa/T-154.md): el diseño
    // por FILA (tope anterior 220) se revirtió porque rompía el agrupamiento
    // Aero (Band por fila → Panel por fila). El ítem de FlashList vuelve a
    // ser el BLOQUE completo (un solo `Band` para los 20 contactos, el JSX
    // original de `ff2c4eb`) — con un solo bloque, no hay virtualización
    // posible DENTRO del bloque, así que el número vuelve a acercarse al
    // baseline sin FlashList (229). Medido: 228. El tope sube de 220 a 235
    // (mismo valor que Grupos, mismo dataset de 20 ítems en un solo bloque)
    // — no es mover el poste para maquillar una regresión: es la
    // consecuencia directa y esperada de la decisión de diseño de QA
    // ("si la pantalla tenía un solo bloque, es un solo ítem y está bien:
    // la ganancia en esas dos es de escala futura"). Sigue protegiendo
    // contra una regresión real (headers/footer duplicados, filas que se
    // dupliquen, etc.), sólo que ya no exige virtualización interna que el
    // propio diseño (mandado por QA) no puede dar con un solo bloque.
    expect(nodos).toBeLessThan(235);
  });
});
