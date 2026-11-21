import {
  calcularAbanico, GAP_CUBOS, PASO_CUBOS, MARGEN_ABANICO,
} from '@/src/components/menu/calcularAbanico';
import { CUBO_TAMANO } from '@/src/components/CuboIcono';

const VENTANA = { width: 400, height: 800 };
const SIN_INSETS = { top: 0, bottom: 0 };
const ancla = { x: 36, y: 200, width: CUBO_TAMANO, height: CUBO_TAMANO };

describe('calcularAbanico', () => {
  it('el primer cubo ocupa exactamente el rect del ancla', () => {
    const a = calcularAbanico(ancla, VENTANA, SIN_INSETS, 3);
    expect([a.left, a.top]).toEqual([ancla.x, ancla.y]);
  });

  it('los slots bajan con paso fijo (cubo + gap) desde el primero', () => {
    expect(PASO_CUBOS).toBe(CUBO_TAMANO + GAP_CUBOS);
    const a = calcularAbanico(ancla, VENTANA, SIN_INSETS, 4);
    expect(a.altoColumna).toBe(4 * CUBO_TAMANO + 3 * GAP_CUBOS);
  });

  it('si entra hacia abajo no scrollea y el alto visible es el de la columna', () => {
    const a = calcularAbanico(ancla, VENTANA, SIN_INSETS, 5);
    expect(a.scrolla).toBe(false);
    expect(a.alto).toBe(a.altoColumna);
  });

  it('si no entra hasta el borde seguro, scrollea y recorta al espacio libre', () => {
    const a = calcularAbanico(ancla, { width: 400, height: 500 }, { top: 0, bottom: 34 }, 9);
    expect(a.scrolla).toBe(true);
    expect(a.alto).toBe(500 - 34 - MARGEN_ABANICO - ancla.y);
    expect(a.top).toBe(ancla.y); // el primer cubo no se mueve
  });

  it('los insets inferiores achican el espacio (Android edge-to-edge, R1)', () => {
    const sin = calcularAbanico(ancla, VENTANA, SIN_INSETS, 7);
    const con = calcularAbanico(ancla, VENTANA, { top: 0, bottom: 300 }, 7);
    expect(sin.scrolla).toBe(false);
    expect(con.scrolla).toBe(true);
  });

  it('el ancho llega hasta el margen derecho de la pantalla', () => {
    const a = calcularAbanico(ancla, VENTANA, SIN_INSETS, 2);
    expect(a.left + a.ancho).toBe(VENTANA.width - MARGEN_ABANICO);
  });

  it('sin opciones no hay alto', () => {
    expect(calcularAbanico(ancla, VENTANA, SIN_INSETS, 0).altoColumna).toBe(0);
  });
});
