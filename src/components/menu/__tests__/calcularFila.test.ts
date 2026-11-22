import {
  calcularFila, scrollInicial, ANCHO_CAPSULA, ALTO_CAPSULA, GAP_FILA, SEPARACION_FILA, PASO_CAPSULA,
} from '@/src/components/menu/calcularFila';
import { MARGEN_ABANICO, VISIBLES } from '@/src/components/menu/calcularAbanico';

const VENTANA = { width: 400, height: 800 };
const SIN_INSETS = { top: 0, bottom: 0 };
const chip = (x: number, y: number, width = 100, height = 44) => ({ x, y, width, height });

describe('calcularFila (T-282 t2: fila horizontal anclada)', () => {
  it('ancla en la mitad izquierda: crece hacia la derecha, alineada al borde izquierdo del ancla', () => {
    const f = calcularFila(chip(40, 300), VENTANA, SIN_INSETS, 7);
    expect(f.haciaDerecha).toBe(true);
    expect(f.left).toBe(40);
  });

  it('ancla en la mitad derecha: crece hacia la izquierda, alineada al borde derecho del ancla', () => {
    const f = calcularFila(chip(260, 300), VENTANA, SIN_INSETS, 7);
    expect(f.haciaDerecha).toBe(false);
    expect(f.left + f.anchoVentana).toBe(260 + 100);
  });

  it('abajo si entra la fila más la separación por encima del inset inferior + margen', () => {
    const f = calcularFila(chip(40, 300), VENTANA, SIN_INSETS, 3);
    expect(f.lado).toBe('abajo');
    expect(f.top).toBe(300 + 44 + SEPARACION_FILA);
  });

  it('arriba si abajo no entra (el chip de la barra del gasto)', () => {
    const f = calcularFila(chip(40, 740), VENTANA, { top: 0, bottom: 34 }, 3);
    expect(f.lado).toBe('arriba');
    expect(f.top).toBe(740 - SEPARACION_FILA - ALTO_CAPSULA);
  });

  it('arriba: nunca sube por encima de insets.top + margen (ancla cerca del borde superior)', () => {
    // Ventana baja: no entra abajo y arriba tampoco sin pisar el notch.
    const insets = { top: 59, bottom: 0 };
    const f = calcularFila(chip(40, 100, 100, 44), { width: 400, height: 180 }, insets, 3);
    expect(f.lado).toBe('arriba');
    expect(f.top).toBeGreaterThanOrEqual(59 + MARGEN_ABANICO);
  });

  it('arriba: si entra, no se mueve; si no, queda pegada al límite superior y desdeY lo refleja', () => {
    const insets = { top: 59, bottom: 34 };
    const holgada = calcularFila(chip(40, 400, 100, 44), { width: 400, height: 440 }, insets, 3);
    expect(holgada.lado).toBe('arriba');
    expect(holgada.top).toBe(400 - SEPARACION_FILA - ALTO_CAPSULA);
    const apretada = calcularFila(chip(40, 90, 100, 44), { width: 400, height: 140 }, insets, 3);
    expect(apretada.lado).toBe('arriba');
    expect(apretada.top).toBe(59 + MARGEN_ABANICO);
    expect(apretada.desdeY).toBe(90 + 22 - (apretada.top + ALTO_CAPSULA / 2));
  });

  it('el borde exacto entra abajo; un punto más ya no', () => {
    const limite = VENTANA.height - MARGEN_ABANICO - ALTO_CAPSULA - SEPARACION_FILA - 44;
    expect(calcularFila(chip(40, limite), VENTANA, SIN_INSETS, 3).lado).toBe('abajo');
    expect(calcularFila(chip(40, limite + 1), VENTANA, SIN_INSETS, 3).lado).toBe('arriba');
  });

  it('con 7 opciones se ven exactamente 4 de ancho fijo y el resto scrollea', () => {
    const f = calcularFila(chip(40, 300), VENTANA, SIN_INSETS, 7);
    expect(VISIBLES).toBe(4);
    expect(f.anchoVentana).toBe(4 * ANCHO_CAPSULA + 3 * GAP_FILA);
    expect(f.anchoContenido).toBe(7 * ANCHO_CAPSULA + 6 * GAP_FILA);
    expect(f.scrolla).toBe(true);
  });

  it('ventana ancha: el tope es VISIBLES aunque entrarían más (aísla el 4)', () => {
    const ancha = { width: 600, height: 800 };
    const entranMas = Math.floor((ancha.width - 2 * MARGEN_ABANICO + GAP_FILA) / PASO_CAPSULA);
    expect(entranMas).toBeGreaterThan(4);
    const f = calcularFila(chip(40, 300), ancha, SIN_INSETS, 7);
    // 4 literal a propósito: si el tope cambia, este test debe enterarse.
    expect(f.anchoVentana).toBe(4 * ANCHO_CAPSULA + 3 * GAP_FILA);
    expect(f.scrolla).toBe(true);
  });

  it('con 4 o menos no scrollea y la ventana mide justo lo que hay', () => {
    const f = calcularFila(chip(40, 300), VENTANA, SIN_INSETS, 3);
    expect(f.scrolla).toBe(false);
    expect(f.anchoVentana).toBe(f.anchoContenido);
    expect(calcularFila(chip(40, 300), VENTANA, SIN_INSETS, 4).scrolla).toBe(false);
  });

  it('clamp: nunca pasa de los márgenes de pantalla (ancla pegada al borde derecho)', () => {
    const f = calcularFila(chip(300, 300, 90), VENTANA, SIN_INSETS, 7);
    expect(f.left).toBeGreaterThanOrEqual(MARGEN_ABANICO);
    expect(f.left + f.anchoVentana).toBeLessThanOrEqual(VENTANA.width - MARGEN_ABANICO);
  });

  it('clamp: ancla pegada al borde izquierdo no se sale por la izquierda', () => {
    const f = calcularFila(chip(2, 300, 40), VENTANA, SIN_INSETS, 7);
    expect(f.left).toBe(MARGEN_ABANICO);
  });

  it('pantalla angosta: muestra las que entren (menos de 4), nunca se sale', () => {
    const f = calcularFila(chip(20, 300), { width: 320, height: 800 }, SIN_INSETS, 7);
    expect(f.anchoVentana).toBeLessThanOrEqual(320 - 2 * MARGEN_ABANICO);
    expect(f.anchoVentana).toBe(3 * ANCHO_CAPSULA + 2 * GAP_FILA);
    expect(f.scrolla).toBe(true);
  });

  it('origenX lleva la cápsula del slot al ancla según el lado', () => {
    const d = calcularFila(chip(40, 300), VENTANA, SIN_INSETS, 7);
    expect(d.origenX).toBe(40 - d.left);
    const i = calcularFila(chip(260, 300), VENTANA, SIN_INSETS, 7);
    expect(i.origenX).toBe(260 + 100 - ANCHO_CAPSULA - i.left);
  });

  it('una sola opción: ventana de una cápsula', () => {
    const f = calcularFila(chip(40, 300), VENTANA, SIN_INSETS, 1);
    expect(f.anchoVentana).toBe(ANCHO_CAPSULA);
    expect(f.scrolla).toBe(false);
  });
});

describe('scrollInicial', () => {
  const max = (n: number) => n * ANCHO_CAPSULA + (n - 1) * GAP_FILA - (4 * ANCHO_CAPSULA + 3 * GAP_FILA);

  it('derecha: arranca en 0 si la actual está entre las 4 primeras', () => {
    const h = calcularFila(chip(40, 300), VENTANA, SIN_INSETS, 7);
    expect(scrollInicial(h, 0)).toBe(0);
    expect(scrollInicial(h, 3)).toBe(0);
  });

  it('derecha: corre lo justo para mostrar una actual lejana y no pasa del final', () => {
    const h = calcularFila(chip(40, 300), VENTANA, SIN_INSETS, 7);
    expect(scrollInicial(h, 4)).toBe(PASO_CAPSULA);
    expect(scrollInicial(h, 6)).toBe(max(7));
  });

  it('izquierda: arranca al final (lo más cercano al ancla) y retrocede para la actual lejana', () => {
    const h = calcularFila(chip(260, 300), VENTANA, SIN_INSETS, 7);
    expect(scrollInicial(h, 0)).toBe(max(7));
    expect(scrollInicial(h, 4)).toBe(max(7) - PASO_CAPSULA);
  });

  it('sin scroll (cabe todo) es 0', () => {
    expect(scrollInicial(calcularFila(chip(260, 300), VENTANA, SIN_INSETS, 3), 2)).toBe(0);
  });
});
