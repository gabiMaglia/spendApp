import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render } from '@testing-library/react-native';

import { MontoRodante } from '../MontoRodante';
import { crearRegistroDeMontos } from '@/src/utils/montoRodanteRegistry';
import { formatMoney } from '@/src/constants/currencies';

/**
 * T-106 — «los números que giran» (`number-flow-react-native` como motor,
 * corrección del PO 2026-09-13). Acá SOLO se testea comportamiento visible/
 * accesible y la decisión de animar, nunca la animación en sí — la decisión
 * pura vive en `montoRodanteRegistry.test.ts`; esto verifica que el
 * componente la respeta de punta a punta, y que el texto final es BYTE A
 * BYTE el de `formatMoney` (nunca se re-formatea a mano, así que se compara
 * contra la MISMA función en vez de contra un string tipeado a mano).
 *
 * Las aserciones sobre la PRIMERA aparición usan `findByLabelText` (async):
 * en esa situación el componente monta con una semilla y pasa al valor real
 * en el siguiente `requestAnimationFrame` (ver `numeroSemilla`) — hay que
 * esperar ese frame para ver el valor asentado, igual que en un dispositivo
 * real. Nada de esto testea la animación en sí, sólo que el valor FINAL
 * termina siendo el correcto.
 */
describe('MontoRodante', () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('el valor accesible coincide EXACTO con `formatMoney` (ARS, centavos en cero se ocultan)', async () => {
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="x" minor={123400} code="ARS" registry={registro} />);
    expect(await r.findByLabelText(formatMoney(123400, 'ARS'))).toBeTruthy();
  });

  it('negativo con signo fijo (prefix), sin decimales', async () => {
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="x" minor={-123400} code="ARS" prefix="-" registry={registro} />);
    expect(await r.findByLabelText(`-${formatMoney(123400, 'ARS')}`)).toBeTruthy();
  });

  it('símbolo de dos caracteres (US$) y con decimales reales', async () => {
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="x" minor={1234567} code="USD" registry={registro} />);
    expect(await r.findByLabelText(formatMoney(1234567, 'USD'))).toBeTruthy();
  });

  it('CLP sin decimales (moneda de 0 decimales)', async () => {
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="x" minor={1500} code="CLP" registry={registro} />);
    expect(await r.findByLabelText(formatMoney(1500, 'CLP'))).toBeTruthy();
  });

  it('PYG sin decimales (moneda de 0 decimales)', async () => {
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="x" minor={2000} code="PYG" registry={registro} />);
    expect(await r.findByLabelText(formatMoney(2000, 'PYG'))).toBeTruthy();
  });

  it('sin `code`, es un conteo simple: el número tal cual, sin agrupar', async () => {
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="x" minor={47} registry={registro} />);
    expect(await r.findByLabelText('47')).toBeTruthy();
  });

  it('con "reducir movimiento" activado, muestra el valor final sin animar (nunca pasa por la semilla)', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="x" minor={123400} code="ARS" registry={registro} />);
    // Con reduce motion, el label final tiene que estar ahí YA, sin esperar
    // ningún frame — es la garantía de que el truco de semilla no se aplicó.
    expect(r.getByLabelText(formatMoney(123400, 'ARS'))).toBeTruthy();
  });

  it('al cambiar el valor estando ya montado, se muestra el nuevo de inmediato (sin truco de semilla)', async () => {
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="x" minor={100000} code="ARS" registry={registro} />);
    await r.findByLabelText(formatMoney(100000, 'ARS'));

    r.rerender(<MontoRodante id="x" minor={250000} code="ARS" registry={registro} />);
    expect(r.getByLabelText(formatMoney(250000, 'ARS'))).toBeTruthy();
    expect(r.queryByLabelText(formatMoney(100000, 'ARS'))).toBeNull();
  });

  it('cambio de divisa con la misma magnitud: el texto cambia (símbolo distinto) y se muestra', async () => {
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="x" minor={100000} code="ARS" registry={registro} />);
    await r.findByLabelText(formatMoney(100000, 'ARS'));

    r.rerender(<MontoRodante id="x" minor={100000} code="USD" registry={registro} />);
    expect(r.getByLabelText(formatMoney(100000, 'USD'))).toBeTruthy();
    expect(r.queryByLabelText(formatMoney(100000, 'ARS'))).toBeNull();
  });

  it('si cambia la cantidad de dígitos, no rompe: se ve el valor final completo', async () => {
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="x" minor={900} code="ARS" registry={registro} />);
    await r.findByLabelText(formatMoney(900, 'ARS'));

    r.rerender(<MontoRodante id="x" minor={1000000} code="ARS" registry={registro} />);
    expect(r.getByLabelText(formatMoney(1000000, 'ARS'))).toBeTruthy();
  });

  it('remontar con el MISMO id+valor que ya se vio en el registro no dispara el truco de semilla', async () => {
    // Simula "volver a la pestaña": el registro ya tiene este id+valor de una
    // corrida anterior (montado y desmontado). El remount debe mostrar el
    // valor directo, sin pasar por la semilla ni esperar un frame.
    const registro = crearRegistroDeMontos();
    registro.set('x', formatMoney(123400, 'ARS'));
    const r = render(<MontoRodante id="x" minor={123400} code="ARS" registry={registro} />);
    expect(r.getByLabelText(formatMoney(123400, 'ARS'))).toBeTruthy();
  });
});
