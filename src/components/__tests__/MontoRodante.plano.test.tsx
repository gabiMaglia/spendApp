import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';

import {
  crearRegistroDeMontos, __resetProximoRetrasoParaTests,
} from '@/src/utils/montoRodanteRegistry';
import { formatMoney } from '@/src/constants/currencies';

/**
 * T-221 (perf, causa raíz T-216): `MontoRodante` montaba `NumberFlow`
 * SIEMPRE, incluso cuando `debeRodar` decía que no había nada que animar —
 * ~84 `Animated.Text` por monto, 5-10 instancias por pestaña, commits de
 * hasta 2470ms en gama baja (ver `engram/qa/T-216.md`, Ronda 3).
 *
 * Acá se prueba SÓLO la decisión de montar/desmontar `NumberFlow` (mock
 * identificable por `testID`, no interesa la animación en sí — eso ya lo
 * cubren `MontoRodante.test.tsx` y `.pendingSequence.test.tsx`, que deben
 * seguir en verde sin tocarlos).
 */
const NUMBERFLOW_TESTID = '__numberflow_mock__';

jest.mock('number-flow-react-native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactActual = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: RNText } = require('react-native');
  return {
    NumberFlow: (props: { value: number }) => ReactActual.createElement(
      RNText,
      { testID: NUMBERFLOW_TESTID },
      String(props.value),
    ),
  };
});

// Import DESPUÉS del mock (jest.mock hoistea, pero mantiene el orden legible).
// eslint-disable-next-line import/first
import { MontoRodante } from '../MontoRodante';

/**
 * `waitFor` (con timers reales, polling) en vez de un `act(async () => await
 * new Promise(setTimeout(...)))` de una sola espera larga: se probó esto
 * último y quedaba en carrera con los `setTimeout` reales internos del
 * componente — el estado terminaba actualizándose (con el warning de React
 * de "update no envuelto en act") pero el árbol que ve el test no llegaba a
 * reflejarlo antes de la aserción. `waitFor` reintenta la aserción a
 * intervalos reales, cada uno ya envuelto en `act` por la librería.
 */
async function esperarQueTermineElGiro(getTree: () => unknown) {
  await waitFor(() => {
    expect(getTree()).toBeNull();
  }, { timeout: 3000 });
}

describe('MontoRodante — plano vs. girando (T-221)', () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    __resetProximoRetrasoParaTests();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('a) segunda aparición con el mismo id+valor ya visto: nunca monta NumberFlow, es Text plano', () => {
    const registro = crearRegistroDeMontos();
    registro.set('x', formatMoney(123400, 'ARS'));
    const r = render(<MontoRodante id="x" minor={123400} code="ARS" registry={registro} />);

    expect(r.queryByTestId(NUMBERFLOW_TESTID)).toBeNull();
    expect(r.getByText(formatMoney(123400, 'ARS'))).toBeTruthy();
  });

  it('b) primera aparición: monta NumberFlow y, al terminar el giro, vuelve a Text plano con el valor final', async () => {
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="y" minor={123400} code="ARS" registry={registro} />);

    // El efecto que decide animar depende de `useAnimacionesReducidas`
    // (async: consulta `AccessibilityInfo`) — hay que dejarlo resolver antes
    // de esperar que `NumberFlow` ya esté montado.
    await waitFor(() => {
      expect(r.queryByTestId(NUMBERFLOW_TESTID)).toBeTruthy();
    });

    await esperarQueTermineElGiro(() => r.queryByTestId(NUMBERFLOW_TESTID));

    expect(r.getByText(formatMoney(123400, 'ARS'))).toBeTruthy();
  });

  it('c) cambio de valor estando ya plano: vuelve a montar NumberFlow y después vuelve a Text', async () => {
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="z" minor={123400} code="ARS" registry={registro} />);
    await waitFor(() => { expect(r.queryByTestId(NUMBERFLOW_TESTID)).toBeTruthy(); });
    await esperarQueTermineElGiro(() => r.queryByTestId(NUMBERFLOW_TESTID));

    r.rerender(<MontoRodante id="z" minor={999900} code="ARS" registry={registro} />);
    expect(r.queryByTestId(NUMBERFLOW_TESTID)).toBeTruthy();

    await esperarQueTermineElGiro(() => r.queryByTestId(NUMBERFLOW_TESTID));

    expect(r.getByText(formatMoney(999900, 'ARS'))).toBeTruthy();
  });

  it('d) con "reducir movimiento" activado, nunca monta NumberFlow', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="w" minor={123400} code="ARS" registry={registro} />);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(r.queryByTestId(NUMBERFLOW_TESTID)).toBeNull();
    expect(r.getByText(formatMoney(123400, 'ARS'))).toBeTruthy();
  });
});
