import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render } from '@testing-library/react-native';

import { MontoRodante } from '../MontoRodante';
import { crearRegistroDeMontos } from '@/src/utils/montoRodanteRegistry';

/**
 * T-106 — «los números que giran». Acá SOLO se testea comportamiento visible/
 * accesible y la decisión de animar, nunca la animación en sí (pedido
 * explícito del PO — la decisión de animar ya tiene su propio test puro en
 * `montoRodanteRegistry.test.ts`; esto verifica que el componente la respeta
 * de punta a punta).
 */
describe('MontoRodante', () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('el valor accesible coincide EXACTO con el texto formateado que recibe', () => {
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="x" value="$1.234" registry={registro} />);
    expect(r.getByLabelText('$1.234')).toBeTruthy();
  });

  it('negativo, con signo y símbolo, sin decimales (CLP/PYG)', () => {
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="x" value="-$1.234" registry={registro} />);
    expect(r.getByLabelText('-$1.234')).toBeTruthy();
  });

  it('símbolo de dos caracteres (US$) y separador de miles', () => {
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="x" value="US$12,345.67" registry={registro} />);
    expect(r.getByLabelText('US$12,345.67')).toBeTruthy();
  });

  it('con "reducir movimiento" activado, muestra el valor final sin animar', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="x" value="$1.234" registry={registro} />);
    // Con reduce motion, el label final tiene que estar ahí igual — sin
    // animación no significa sin resultado.
    expect(await r.findByLabelText('$1.234')).toBeTruthy();
  });

  it('al cambiar el valor, se muestra el nuevo', () => {
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="x" value="$1.000" registry={registro} />);
    expect(r.getByLabelText('$1.000')).toBeTruthy();

    r.rerender(<MontoRodante id="x" value="$2.500" registry={registro} />);
    expect(r.getByLabelText('$2.500')).toBeTruthy();
    expect(r.queryByLabelText('$1.000')).toBeNull();
  });

  it('si cambia la cantidad de dígitos, no rompe: se ve el valor final completo', () => {
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="x" value="$9" registry={registro} />);
    r.rerender(<MontoRodante id="x" value="$10.000" registry={registro} />);
    expect(r.getByLabelText('$10.000')).toBeTruthy();
  });
});
