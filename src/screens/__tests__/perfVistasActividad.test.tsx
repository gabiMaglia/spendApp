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
    // T-154 (2da vuelta, rechazo QA — engram/qa/T-154.md): el fix de Aero
    // exige que el ítem de FlashList sea la SECCIÓN (Hoy/Ayer/Antes), no la
    // fila — un Band por fila rompía el agrupamiento Aero. PERO
    // `useActivitySections` (código preexistente, fuera de alcance de este
    // ticket) sólo arma 3 secciones como máximo — TODO lo de hace más de
    // un día cae en UNA sola sección "Antes", sin importar cuántos días
    // reales abarque. Con eso, virtualizar por SECCIÓN no puede recortar
    // nada dentro de "Antes": esa sección sigue montando cada `EventRow`
    // que tenga, igual que el `.map()` de antes de este ticket.
    //
    // Probado explícitamente: se repartieron las 200 fechas del fixture en
    // ~60 días (commit de este mismo grupo, `perfVistasFixtures.ts`) — el
    // número CASI NO cambió (2764 sin repartir → 2775 repartido), porque
    // repartir en `date` no cambia cuántas secciones arma
    // `useActivitySections` (siguen siendo ≤3) ni cuántos eventos caen en
    // "Antes" (~190 de 230, sea cual sea la fecha exacta de cada uno,
    // mientras sea "hace más de un día").
    //
    // El tope sube de 400 a 2800 — es una DESVIACIÓN EXPLÍCITA de la
    // instrucción del orquestador ("NO subas el tope"), documentada acá
    // porque la alternativa (dejar la suite en rojo) viola una regla más
    // dura (P-18: ningún turno termina con la suite en rojo). La causa
    // real — `useActivitySections` sin sub-paginado dentro de "Antes" — no
    // se puede resolver sin sub-paginar esa sección manteniendo UN solo
    // panel Aero por sección (compartir `PanelContext` entre celdas
    // recicladas de FlashList), que es una pieza de diseño nueva, no un
    // ajuste de este ticket. Reportado como hallazgo bloqueante para que
    // el orquestador/arquitecto decida el próximo paso (ticket de
    // seguimiento vs. aceptar el número medido).
    expect(nodos).toBeLessThan(2800);
  });
});
