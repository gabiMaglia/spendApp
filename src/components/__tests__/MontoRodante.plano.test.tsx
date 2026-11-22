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
 * T-284: timers FALSOS. Antes se esperaba el giro con `waitFor` y relojes
 * reales (hasta 3 s por espera): con la suite completa en paralelo el event
 * loop del worker se atrasaba y el caso c) se pasaba del timeout. El giro
 * dura a lo sumo `MAX_PASOS*PASO_MS + 350 + 60` ≈ 554 ms de reloj del
 * componente; avanzar el reloj falso lo recorre completo sin depender de la
 * carga de la máquina.
 */
const MS_DE_SOBRA_PARA_TERMINAR_EL_GIRO = 1000;

function terminarElGiro() {
  act(() => { jest.advanceTimersByTime(MS_DE_SOBRA_PARA_TERMINAR_EL_GIRO); });
}

/** Deja resolver la consulta async de `AccessibilityInfo` (microtareas). */
async function dejarResolverAccesibilidad() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('MontoRodante — plano vs. girando (T-221)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    __resetProximoRetrasoParaTests();
  });

  afterEach(() => {
    jest.useRealTimers();
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
    await dejarResolverAccesibilidad();
    expect(r.queryByTestId(NUMBERFLOW_TESTID)).toBeTruthy();

    terminarElGiro();
    expect(r.queryByTestId(NUMBERFLOW_TESTID)).toBeNull();

    expect(r.getByText(formatMoney(123400, 'ARS'))).toBeTruthy();
  });

  it('c) cambio de valor estando ya plano: vuelve a montar NumberFlow y después vuelve a Text', async () => {
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="z" minor={123400} code="ARS" registry={registro} />);
    await dejarResolverAccesibilidad();
    expect(r.queryByTestId(NUMBERFLOW_TESTID)).toBeTruthy();
    terminarElGiro();
    expect(r.queryByTestId(NUMBERFLOW_TESTID)).toBeNull();

    r.rerender(<MontoRodante id="z" minor={999900} code="ARS" registry={registro} />);
    expect(r.queryByTestId(NUMBERFLOW_TESTID)).toBeTruthy();

    terminarElGiro();
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
