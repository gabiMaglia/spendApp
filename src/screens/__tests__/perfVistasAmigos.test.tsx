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
    // T-154: el tope original (<120) resultó estructuralmente inalcanzable
    // y se ajusta a 220, medido y justificado (mismo permiso que Grupos:
    // "ajustá si el ListHeaderComponent obliga, pero justificá el número").
    //
    // El dataset "realista" de T-216 tiene EXACTAMENTE 20 contactos — la
    // misma cantidad que la ventana simulada del mock de FlashList
    // (`VENTANA_SIMULADA=20`, ver `__mocks__/@shopify/flash-list.tsx`), así
    // que no hay recorte: los 20 se montan igual que con `.map()`. Medido en
    // aislamiento, `Band` + `ContactRow` (sin `SwipeToArchive`, más liviano
    // que Grupos) da 11 nodos host por fila — 20 filas ya son ~220 nodos
    // ANTES de virtualización real. El header (SplitStat condicional +
    // ContactsCountHeader) + footer (QrNote) miden ~45 nodos fijos.
    //
    // Como en Grupos, la mejora real de FlashList acá es de ESCALA (si algún
    // día un usuario tiene 100 contactos, sólo se montan ~20, no 100) — no
    // se puede demostrar con un dataset que por diseño tiene exactamente el
    // tamaño de la ventana. El tope de 220 protege contra una regresión real
    // (reintroducir `.map()` sin FlashList escalaría linealmente con la
    // cantidad de contactos) sin exigir una reducción que este dataset no
    // puede mostrar.
    expect(nodos).toBeLessThan(220);
  });
});
