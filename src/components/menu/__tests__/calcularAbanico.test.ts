import {
  calcularAbanico, GAP_CUBOS, PASO_FILA, ALTO_FILA, SEPARACION_ANCLA, MARGEN_ABANICO, VISIBLES,
} from '@/src/components/menu/calcularAbanico';
import { CUBO_TAMANO } from '@/src/components/CuboIcono';

const VENTANA = { width: 400, height: 800 };
const SIN_INSETS = { top: 0, bottom: 0 };
const ancla = { x: 36, y: 200, width: CUBO_TAMANO, height: CUBO_TAMANO };

describe('calcularAbanico (T-285: columna al costado, cápsulas, 4 visibles)', () => {
  it('la columna arranca a la altura del ancla y SEPARACION_ANCLA (16) a su derecha', () => {
    expect(SEPARACION_ANCLA).toBe(16);
    const a = calcularAbanico(ancla, VENTANA, SIN_INSETS, 3);
    expect(a.top).toBe(ancla.y);
    expect(a.left).toBe(ancla.x + ancla.width + 16);
  });

  it('el cubo original no queda tapado: ninguna fila intersecta el rect del ancla', () => {
    const a = calcularAbanico(ancla, VENTANA, SIN_INSETS, 9);
    for (let i = 0; i < 9; i++) {
      const fila = { x: a.left, y: a.top + i * PASO_FILA, w: a.ancho, h: ALTO_FILA };
      const choca = fila.x < ancla.x + ancla.width && fila.x + fila.w > ancla.x
        && fila.y < ancla.y + ancla.height && fila.y + fila.h > ancla.y;
      expect(choca).toBe(false);
    }
  });

  it('las filas bajan con paso fijo (cápsula + gap)', () => {
    expect(ALTO_FILA).toBe(CUBO_TAMANO + 12);
    expect(PASO_FILA).toBe(ALTO_FILA + GAP_CUBOS);
    expect(calcularAbanico(ancla, VENTANA, SIN_INSETS, 3).altoColumna).toBe(3 * ALTO_FILA + 2 * GAP_CUBOS);
  });

  it('con 9 opciones se ven exactamente 4 filas y el resto scrollea', () => {
    expect(VISIBLES).toBe(4);
    const a = calcularAbanico(ancla, VENTANA, SIN_INSETS, 9);
    expect(a.alto).toBe(4 * ALTO_FILA + 3 * GAP_CUBOS);
    expect(a.scrolla).toBe(true);
  });

  it('con 4 o menos que entran no scrollea y el alto es el de la columna', () => {
    const a = calcularAbanico(ancla, VENTANA, SIN_INSETS, 3);
    expect(a.scrolla).toBe(false);
    expect(a.alto).toBe(a.altoColumna);
    expect(calcularAbanico(ancla, VENTANA, SIN_INSETS, 4).scrolla).toBe(false);
  });

  it('si no entran 4 hasta el borde seguro, muestra las que entren (nunca pasa del borde)', () => {
    const ventana = { width: 400, height: 500 };
    const insets = { top: 0, bottom: 34 };
    const limite = 500 - 34 - MARGEN_ABANICO;
    const a = calcularAbanico(ancla, ventana, insets, 9); // libre = 250 → entran 3
    expect(a.alto).toBe(3 * ALTO_FILA + 2 * GAP_CUBOS);
    expect(a.top + a.alto).toBeLessThanOrEqual(limite);
    expect(a.scrolla).toBe(true);
    expect(a.top).toBe(ancla.y); // la columna no se mueve: scrollea
  });

  it('los insets inferiores achican el espacio (Android edge-to-edge, R1)', () => {
    const sin = calcularAbanico(ancla, VENTANA, SIN_INSETS, 3);
    const con = calcularAbanico(ancla, VENTANA, { top: 0, bottom: 500 }, 3);
    expect(sin.scrolla).toBe(false);
    expect(con.scrolla).toBe(true);
  });

  it('aunque no entre ni una, muestra una (no queda una columna sin alto)', () => {
    const a = calcularAbanico(ancla, { width: 400, height: 220 }, SIN_INSETS, 5);
    expect(a.alto).toBe(ALTO_FILA);
  });

  it('el ancho llega hasta el margen derecho de la pantalla', () => {
    const a = calcularAbanico(ancla, VENTANA, SIN_INSETS, 2);
    expect(a.left + a.ancho).toBe(VENTANA.width - MARGEN_ABANICO);
  });

  it('desdeX lleva la cápsula de vuelta al cubo original', () => {
    const a = calcularAbanico(ancla, VENTANA, SIN_INSETS, 2);
    expect(a.left + a.desdeX).toBe(ancla.x);
  });

  it('sin opciones no hay alto', () => {
    const a = calcularAbanico(ancla, VENTANA, SIN_INSETS, 0);
    expect([a.altoColumna, a.alto, a.scrolla]).toEqual([0, 0, false]);
  });
});
