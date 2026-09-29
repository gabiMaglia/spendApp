import React from 'react';
import { render } from '@testing-library/react-native';

import ActivityScreen from '@/app/(tabs)/activity';
import { sembrarDatasetRealista, contarNodosHost } from './perfVistasFixtures';

/**
 * T-216 — pregunta 2: nodos host de la pestaña Actividad. Los eventos de
 * actividad se derivan de gastos+pagos (`useActivityFeed`) — con 200 gastos
 * + 30 pagos hay bastante más de 60 eventos, cubre de sobra el piso pedido
 * por el ticket.
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

describe('T-216 — nodos host: Actividad', () => {
  it('cuenta los nodos host del árbol montado', () => {
    const r = render(<ActivityScreen />);
    const nodos = contarNodosHost(r.toJSON());
    console.log('[T-216][nodosHost] Actividad=%s', nodos);
    // T-154 (3ra vuelta — decisión del orquestador): el tope vuelve a 400.
    // El ítem de FlashList vuelve a ser la FILA (con el panel Aero
    // segmentado, `Panel.tsx`/`segmento`, en vez de un Panel por sección) —
    // la ventana simulada del mock (VENTANA_SIMULADA=20) vuelve a recortar
    // FILAS dentro de la sección "Antes", no sólo secciones completas.
    expect(nodos).toBeLessThan(400);
  });
});
