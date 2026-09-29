import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, render } from '@testing-library/react-native';

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
  const ReactActual = require('react');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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

/** Duración total de un giro completo con `turno` en 0 (ver `TIMING_RAPIDO`
 *  en `MontoRodante.tsx` + margen de cierre) — más colchón por las dudas del
 *  entorno de test. */
const ESPERA_FIN_DE_GIRO_MS = 700;

async function esperarFinDeGiro() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ESPERA_FIN_DE_GIRO_MS));
  });
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

    // El efecto ya corrió (RTL lo flushea dentro de `render`): primera
    // aparición de verdad → debe haber montado el giro.
    expect(r.queryByTestId(NUMBERFLOW_TESTID)).toBeTruthy();

    await esperarFinDeGiro();

    expect(r.queryByTestId(NUMBERFLOW_TESTID)).toBeNull();
    expect(r.getByText(formatMoney(123400, 'ARS'))).toBeTruthy();
  });

  it('c) cambio de valor estando ya plano: vuelve a montar NumberFlow y después vuelve a Text', async () => {
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="z" minor={123400} code="ARS" registry={registro} />);
    await esperarFinDeGiro();
    expect(r.queryByTestId(NUMBERFLOW_TESTID)).toBeNull();

    r.rerender(<MontoRodante id="z" minor={999900} code="ARS" registry={registro} />);
    expect(r.queryByTestId(NUMBERFLOW_TESTID)).toBeTruthy();

    await esperarFinDeGiro();

    expect(r.queryByTestId(NUMBERFLOW_TESTID)).toBeNull();
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
