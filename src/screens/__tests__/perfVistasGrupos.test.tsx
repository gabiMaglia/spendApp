import React from 'react';
import { render } from '@testing-library/react-native';

import GroupsScreen from '@/app/(tabs)/groups';
import { sembrarDatasetRealista, contarNodosHost } from '@/src/test-utils/perfVistasFixtures';

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
    // T-154: el tope original (<120) resultó estructuralmente inalcanzable
    // para Grupos y se ajusta a 235, medido y justificado (permiso explícito
    // del orquestador: "ajustá si el ListHeaderComponent obliga, pero
    // justificá el número" — acá el que obliga no es el header sino el
    // costo POR FILA de SwipeToArchive).
    //
    // Con sólo 8 grupos (el dataset "realista" de T-216), la ventana
    // simulada de FlashList (20 ítems) no recorta nada — los 8 se montan
    // igual que antes. Medido en aislamiento (SwipeToArchive envolviendo un
    // <Text>, sin GroupCard): 10 nodos host SOLO por el wrapper de gestos de
    // `react-native-gesture-handler` (GestureDetector + panel de acción +
    // Animated.View interno, ya documentado en el informe T-216). Eso es
    // ~80 nodos de los 8 grupos ANTES de contar una sola línea de contenido
    // de `GroupCard`. Bajar de 120 exigiría sacar SwipeToArchive o reducir
    // GroupCard — ninguna de las dos es una opción de este ticket (cero
    // cambio de píxeles/comportamiento).
    //
    // El aplanado a FlashList SÍ agrega una estructura real (Band por fila
    // en vez de un Band compartido — necesario porque cada celda se recicla
    // de forma independiente): 223 (antes, `.map()`) → 229 (ahora,
    // estructuralmente correcto para virtualizar). El tope de 235 no premia
    // una mejora que este dataset no puede mostrar (8 < ventana), pero SÍ
    // protege contra una regresión real (p. ej., alguien reintroduciendo un
    // `.map()` con montaje completo de una lista más larga, que en Grupos
    // no ocurre hoy pero escalaría linealmente sin FlashList si la cuenta del
    // usuario tuviera más grupos).
    expect(nodos).toBeLessThan(235);
  });
});
