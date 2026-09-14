import { act, renderHook } from '@testing-library/react-native';
import {
  progresoColapso, alturaHeaderColapsable, alturaBloqueTituloVisible, opacidadTituloCompacto,
  useHeaderColapsable, suavizar, opacidadTituloGrande, opacidadTituloGrandeSinMovimiento,
  altoMinimoContenido,
} from '../useHeaderColapsable';

/**
 * T-128 (PO 2026-09-13) — header colapsable al scrollear.
 *
 * Todo esto es matemática pura, sin nativo: se puede testear sin Reanimated
 * de por medio. El shared value / scroll handler se prueban aparte, con el
 * mock oficial de la librería (ver `src/test-utils/setup.ts`).
 */
describe('progresoColapso', () => {
  it('en 0 el header está expandido (progreso 0)', () => {
    expect(progresoColapso(0, 100, 60)).toBe(0);
  });

  it('a mitad del recorrido da 0.5', () => {
    expect(progresoColapso(20, 100, 60)).toBe(0.5);
  });

  it('con scroll >= (expandido - colapsado) queda colapsado (progreso 1)', () => {
    expect(progresoColapso(40, 100, 60)).toBe(1);
    expect(progresoColapso(1000, 100, 60)).toBe(1);
  });

  it('clampea scroll negativo (overscroll / pull-to-refresh) a 0, nunca por debajo', () => {
    expect(progresoColapso(-50, 100, 60)).toBe(0);
    expect(progresoColapso(-1e6, 100, 60)).toBe(0);
  });

  it('no revienta si expandido === colapsado (distancia 0)', () => {
    expect(progresoColapso(10, 60, 60)).toBe(0);
  });
});

describe('alturaHeaderColapsable', () => {
  it('en progreso 0 mide el alto expandido', () => {
    expect(alturaHeaderColapsable(0, 187, 52)).toBe(187);
  });

  it('en progreso 1 mide el alto colapsado', () => {
    expect(alturaHeaderColapsable(1, 187, 52)).toBe(52);
  });

  it('a mitad de progreso es el promedio', () => {
    expect(alturaHeaderColapsable(0.5, 187, 52)).toBeCloseTo((187 + 52) / 2);
  });

  it('invariante: para cualquier progreso en [0,1] el alto nunca baja del colapsado ni supera el expandido (nunca se ve un hueco de mármol)', () => {
    for (const p of [-2, -0.3, 0, 0.2, 0.7, 1, 3, 100]) {
      const clamped = Math.min(1, Math.max(0, p));
      const h = alturaHeaderColapsable(clamped, 187, 52);
      expect(h).toBeGreaterThanOrEqual(52);
      expect(h).toBeLessThanOrEqual(187);
    }
  });
});

describe('alturaBloqueTituloVisible', () => {
  const insetsTop = 47;
  const barH = 52;
  const tituloBlockH = 135;

  it('con el header expandido el bloque título se ve entero', () => {
    const alturaHeader = insetsTop + barH + tituloBlockH;
    expect(alturaBloqueTituloVisible(alturaHeader, insetsTop, barH, tituloBlockH)).toBe(tituloBlockH);
  });

  it('con el header del todo colapsado el bloque título mide 0 (no se ve, ni el título ni el saludo)', () => {
    const alturaHeader = insetsTop + barH;
    expect(alturaBloqueTituloVisible(alturaHeader, insetsTop, barH, tituloBlockH)).toBe(0);
  });

  it('a mitad de camino se ve la mitad del bloque', () => {
    const alturaHeader = insetsTop + barH + tituloBlockH / 2;
    expect(alturaBloqueTituloVisible(alturaHeader, insetsTop, barH, tituloBlockH)).toBeCloseTo(tituloBlockH / 2);
  });

  it('nunca da negativo ni supera el alto total del bloque, ante cualquier alto de header', () => {
    expect(alturaBloqueTituloVisible(0, insetsTop, barH, tituloBlockH)).toBe(0);
    expect(alturaBloqueTituloVisible(9999, insetsTop, barH, tituloBlockH)).toBe(tituloBlockH);
  });
});

describe('opacidadTituloCompacto (título chico junto a la foto de perfil)', () => {
  it('invisible con el header expandido', () => {
    expect(opacidadTituloCompacto(0)).toBe(0);
  });

  it('opaco del todo con el header colapsado', () => {
    expect(opacidadTituloCompacto(1)).toBe(1);
  });

  it('entra recién en la segunda mitad del colapso (cambio de spec del PO: más suave)', () => {
    expect(opacidadTituloCompacto(0.5)).toBe(0);
    expect(opacidadTituloCompacto(0.75)).toBeCloseTo(0.5);
  });
});

describe('movimiento suave del header (PO 2026-09-13)', () => {
  it('suavizar: extremos fijos y monótona', () => {
    expect(suavizar(0)).toBe(0);
    expect(suavizar(1)).toBe(1);
    expect(suavizar(0.5)).toBeCloseTo(0.5);
    for (let p = 0; p < 1; p += 0.05) expect(suavizar(p + 0.05)).toBeGreaterThanOrEqual(suavizar(p));
  });

  it('el borde inferior del header sigue EXACTO al contenido mientras colapsa (T-131, límite fijo)', () => {
    // El contenido sube 1:1 con el scroll; el header tiene que achicarse lo mismo, sin
    // adelantarse ni atrasarse: si no, el primer elemento se mete debajo de la barra.
    const exp = 300, col = 100;
    for (let y = 0; y <= exp - col; y += 7) {
      expect(alturaHeaderColapsable(progresoColapso(y, exp, col), exp, col)).toBeCloseTo(exp - y);
    }
  });

  it('el título grande se va en la primera mitad y el chico entra en la segunda: nunca los dos a la vez', () => {
    expect(opacidadTituloGrande(0)).toBe(1);
    expect(opacidadTituloGrande(0.5)).toBe(0);
    for (let p = 0; p <= 1; p += 0.02) {
      expect(opacidadTituloGrande(p) > 0 && opacidadTituloCompacto(p) > 0).toBe(false);
    }
  });

  it('con «reducir movimiento» el título grande no se desvanece hasta colapsar', () => {
    expect(opacidadTituloGrandeSinMovimiento(0.9)).toBe(1);
    expect(opacidadTituloGrandeSinMovimiento(1)).toBe(0);
  });


  it('con poco contenido igual se puede colapsar: el mínimo supera el alto visible en el recorrido', () => {
    expect(altoMinimoContenido(800, 150)).toBe(950);
  });

  it('sin medir el ScrollView todavía no fuerza ningún mínimo (T-135)', () => {
    expect(altoMinimoContenido(0, 150)).toBe(0);
  });
});

describe('useHeaderColapsable — hook compartido por las seis tabs', () => {
  it('arranca en progreso 0 (header expandido) sin haber scrolleado', () => {
    const { result } = renderHook(() => useHeaderColapsable());
    expect(result.current.progress.value).toBe(0);
  });

  it('expone un scrollHandler para pasarle a Animated.ScrollView/FlatList', () => {
    const { result } = renderHook(() => useHeaderColapsable());
    expect(result.current.scrollHandler).toBeTruthy();
  });

  it('el mínimo sale del alto MEDIDO del ScrollView, no de la ventana: el scroll sobrante es exactamente el recorrido (T-135)', () => {
    const { result } = renderHook(() => useHeaderColapsable({ distanciaColapso: 135 }));
    act(() => {
      result.current.alMedirScroll({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 600 } } } as never);
    });
    // Scroll máximo = minHeight - alto visible = recorrido de colapso, ni un punto más.
    expect(result.current.contenidoMinimo.minHeight - 600).toBe(135);
  });

  it('acepta una distancia de colapso configurable', () => {
    const { result } = renderHook(() => useHeaderColapsable({ distanciaColapso: 40 }));
    expect(result.current.progress.value).toBe(0);
  });
});
