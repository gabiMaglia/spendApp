import {
  calcularPosicionMenu, altoVisibleMenu, GAP_ANCLA, MARGEN_PANTALLA, ANCHO_MINIMO,
} from '@/src/components/menu/calcularPosicionMenu';

const ventana = { width: 400, height: 800 };
const sinInsets = { top: 0, bottom: 0 };
const ancla = (y: number, extra: Partial<{ x: number; width: number; height: number }> = {}) =>
  ({ x: 40, y, width: 300, height: 48, ...extra });

describe('calcularPosicionMenu', () => {
  it('entra abajo: lado abajo, pegado al ancla', () => {
    const p = calcularPosicionMenu(ancla(100), ventana, sinInsets, 200);
    expect(p.lado).toBe('abajo');
    expect(p.top).toBe(100 + 48 + GAP_ANCLA);
    expect(p.maxHeight).toBe(200);
  });

  it('no entra abajo pero sí arriba: lado arriba, termina pegado al ancla', () => {
    const p = calcularPosicionMenu(ancla(650), ventana, sinInsets, 200);
    expect(p.lado).toBe('arriba');
    expect(p.top).toBe(650 - GAP_ANCLA - 200);
  });

  it('no entra en ninguno: usa el lado con más espacio y recorta el alto a ese espacio', () => {
    const p = calcularPosicionMenu(ancla(300), ventana, sinInsets, 700);
    const abajo = 800 - (300 + 48 + GAP_ANCLA);
    expect(p.lado).toBe('abajo');
    expect(p.maxHeight).toBe(abajo);
    const q = calcularPosicionMenu(ancla(500), ventana, sinInsets, 700);
    const arriba = 500 - GAP_ANCLA;
    expect(q.lado).toBe('arriba');
    expect(q.maxHeight).toBe(arriba);
    expect(q.top).toBe(0);
  });

  it('ancho: el del ancla, con mínimo, recortado a los márgenes', () => {
    expect(calcularPosicionMenu(ancla(100, { width: 300 }), ventana, sinInsets, 100).width).toBe(300);
    expect(calcularPosicionMenu(ancla(100, { width: 80 }), ventana, sinInsets, 100).width).toBe(ANCHO_MINIMO);
    expect(calcularPosicionMenu(ancla(100, { x: 0, width: 500 }), ventana, sinInsets, 100).width)
      .toBe(ventana.width - 2 * MARGEN_PANTALLA);
  });

  it('left se corre para no salirse por la derecha ni por la izquierda', () => {
    const der = calcularPosicionMenu(ancla(100, { x: 350, width: 100 }), ventana, sinInsets, 100);
    expect(der.left + der.width).toBe(ventana.width - MARGEN_PANTALLA);
    const izq = calcularPosicionMenu(ancla(100, { x: -10, width: 300 }), ventana, sinInsets, 100);
    expect(izq.left).toBe(MARGEN_PANTALLA);
  });

  it('insets inferior: un menú que entraba justo pasa a arriba', () => {
    const y = 800 - 48 - GAP_ANCLA - 200; // abajo entra exacto sin insets
    expect(calcularPosicionMenu(ancla(y), ventana, sinInsets, 200).lado).toBe('abajo');
    expect(calcularPosicionMenu(ancla(y), ventana, { top: 0, bottom: 34 }, 200).lado).toBe('arriba');
  });

  it('inset superior (Android edge-to-edge): corre el límite de arriba', () => {
    const a = ancla(600);
    const sin = calcularPosicionMenu(a, ventana, sinInsets, 590);
    const con = calcularPosicionMenu(a, ventana, { top: 24, bottom: 0 }, 590);
    expect(sin.lado).toBe('arriba');
    expect(sin.maxHeight).toBe(590);
    expect(con.maxHeight).toBe(600 - GAP_ANCLA - 24);
    expect(con.top).toBe(24);
  });
});

describe('altoVisibleMenu', () => {
  it('suma hasta 5 filas', () => {
    expect(altoVisibleMenu([56, 56, 56])).toBe(168);
    expect(altoVisibleMenu([56, 56, 56, 56, 56])).toBe(280);
  });
  it('con más de 5: 4 filas + media quinta', () => {
    expect(altoVisibleMenu([56, 56, 56, 56, 56, 56])).toBe(4 * 56 + 28);
  });
  it('lista vacía = 0', () => {
    expect(altoVisibleMenu([])).toBe(0);
  });
  it('filas desiguales (con sublabel)', () => {
    expect(altoVisibleMenu([56, 72, 56])).toBe(184);
    expect(altoVisibleMenu([56, 56, 56, 56, 72, 56])).toBe(224 + 36);
  });
});
