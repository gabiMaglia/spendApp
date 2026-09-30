import React from 'react';
import fs from 'fs';
import path from 'path';
import { useSharedValue } from 'react-native-reanimated';
import { render, renderHook } from '@testing-library/react-native';

import { CollapsibleHeader } from '@/src/components/CollapsibleHeader';
import { HEADER_BAR_H, TITLE_BLOCK_H } from '@/src/constants/header';
import { alturaHeaderColapsable, desplazamientoHeader } from '@/src/hooks/useHeaderColapsable';
import {
  AERO_AIRE, REAPARECE, RECORRIDO_AERO, TITULO_AERO_H, aireEntreTarjetas, altoTarjetaTitulo,
  desplazamientoTituloAero, opacidadTarjetaTitulo,
} from '@/src/components/skin/headerAeroGeometria';
import { altoVelo, desplazamientoVelo } from '@/src/components/skin/VeloHeader';
import { useSettingsStore } from '@/src/store/settingsStore';

// Este archivo prueba el skin Clásico. Desde 2026-09-29 el skin inicial es Aero,
// así que se fija Clásico explícitamente.
beforeEach(() => { useSettingsStore.setState({ skin: 'default' }); });

/**
 * **T-220 (PO 2026-09-29, Moto E40): el header colapsable sólo anima
 * `transform` y `opacity`, nunca propiedades de layout.**
 *
 * En Fabric, cada cambio de `height`/`top` que aplica Reanimated ensucia el
 * nodo de Yoga y obliga a recalcular el layout del subárbol del header
 * (mármol, filas, textos) en el hilo de UI, en CADA frame de scroll — medido
 * en T-216: el hilo principal pasaba la mayor parte del tiempo en la fase
 * `animation` del Choreographer. `transform` y `opacity` no tocan Yoga.
 *
 * La geometría visible no cambia: cada borde que antes seguía al contenido
 * 1:1 (T-131) lo sigue igual, ahora como desplazamiento en vez de alto.
 */

const PROPS_DE_LAYOUT = /\b(height|width|top|bottom|left|right|margin\w*|padding\w*|minHeight|maxHeight)\s*:/;

/** Cuerpos de todos los `useAnimatedStyle(...)` del archivo, sin comentarios. */
function cuerposAnimados(archivo: string, hasta?: string): string[] {
  let src = fs.readFileSync(path.join(__dirname, '..', archivo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  if (hasta) src = src.slice(0, src.indexOf(hasta));
  const cuerpos: string[] = [];
  let i = src.indexOf('useAnimatedStyle(');
  while (i !== -1) {
    let j = i + 'useAnimatedStyle('.length;
    let prof = 1;
    while (prof > 0 && j < src.length) {
      if (src[j] === '(') prof++;
      if (src[j] === ')') prof--;
      j++;
    }
    cuerpos.push(src.slice(i, j));
    i = src.indexOf('useAnimatedStyle(', j);
  }
  return cuerpos;
}

describe.each([
  ['CollapsibleHeader.tsx', 'export function DetailHeader'],
  ['skin/HeaderAero.tsx', undefined],
  ['skin/VeloHeader.tsx', undefined],
])('T-220 — guard: %s no anima propiedades de layout', (archivo, hasta) => {
  it('tiene estilos animados (el guard no está mirando un archivo vacío)', () => {
    expect(cuerposAnimados(archivo, hasta).length).toBeGreaterThan(0);
  });

  it('ningún useAnimatedStyle devuelve height/top/width/margin/padding…', () => {
    for (const cuerpo of cuerposAnimados(archivo, hasta)) {
      expect(cuerpo).not.toMatch(PROPS_DE_LAYOUT);
    }
  });
});

describe('T-220 — desplazamientoHeader (Clásico)', () => {
  const E = HEADER_BAR_H + TITLE_BLOCK_H;
  const C = HEADER_BAR_H;

  it('expandido no se mueve; colapsado sube exactamente lo que perdía de alto', () => {
    expect(desplazamientoHeader(0, E, C)).toBe(0);
    expect(desplazamientoHeader(1, E, C)).toBe(E - C);
  });

  it('es lineal, 1:1 con el scroll (T-131)', () => {
    expect(desplazamientoHeader(0.5, E, C)).toBeCloseTo((E - C) / 2, 6);
  });

  it('clampea fuera de [0,1] (overscroll de iOS)', () => {
    expect(desplazamientoHeader(-1, E, C)).toBe(0);
    expect(desplazamientoHeader(2, E, C)).toBe(E - C);
  });

  it('el borde de abajo queda idéntico al del header que se achicaba', () => {
    for (let i = 0; i <= 20; i++) {
      const p = i / 20;
      expect(E - desplazamientoHeader(p, E, C)).toBeCloseTo(alturaHeaderColapsable(p, E, C), 6);
    }
  });
});

describe('T-220 — tarjeta del título Aero con alto fijo', () => {
  it('su borde de abajo sigue al de la tarjeta que se achicaba, punto por punto', () => {
    for (let i = 0; i <= 20; i++) {
      const p = i / 20;
      const antes = aireEntreTarjetas(p) + altoTarjetaTitulo(p, TITULO_AERO_H);
      const ahora = AERO_AIRE + TITULO_AERO_H - desplazamientoTituloAero(p);
      expect(ahora).toBeCloseTo(antes, 6);
    }
  });

  it('el desplazamiento clampea fuera de [0,1]', () => {
    expect(desplazamientoTituloAero(-1)).toBe(0);
    expect(desplazamientoTituloAero(2)).toBe(RECORRIDO_AERO);
  });

  it('opaca hasta que la barra vuelve a redondearse; invisible colapsada', () => {
    expect(opacidadTarjetaTitulo(0)).toBe(1);
    expect(opacidadTarjetaTitulo(REAPARECE)).toBe(1);
    expect(opacidadTarjetaTitulo(1)).toBe(0);
    let previo = 1;
    for (let i = 0; i <= 20; i++) {
      const o = opacidadTarjetaTitulo(i / 20);
      expect(o).toBeLessThanOrEqual(previo);
      previo = o;
    }
  });
});

describe('T-220 — velo Aero con alto fijo', () => {
  it('su borde de abajo sigue al del velo que se achicaba', () => {
    const fondoBarra = 100;
    for (let i = 0; i <= 20; i++) {
      const p = i / 20;
      const antes = altoVelo(fondoBarra, RECORRIDO_AERO * (1 - p));
      const ahora = altoVelo(fondoBarra, RECORRIDO_AERO) - desplazamientoVelo(p);
      expect(ahora).toBeCloseTo(antes, 6);
    }
  });
});

function estiloPlano(nodo: { props: { style?: unknown } }): Record<string, any> {
  const s = nodo.props.style;
  return Array.isArray(s) ? Object.assign({}, ...(s as unknown[]).flat(Infinity)) : (s as Record<string, any>);
}
function translateY(nodo: { props: { style?: unknown } }): number {
  const t = (estiloPlano(nodo).transform ?? []) as Record<string, number>[];
  return t.reduce((acc, x) => acc + (x.translateY ?? 0), 0);
}
function crearProgress(valor: number) {
  return renderHook(() => useSharedValue(valor)).result.current;
}

describe('T-220 — CollapsibleHeader (Clásico) se traslada en vez de achicarse', () => {
  it('el fondo tiene siempre el alto expandido', () => {
    for (const p of [0, 0.5, 1]) {
      const r = render(<CollapsibleHeader title="X" progress={crearProgress(p)} />);
      expect(estiloPlano(r.getByTestId('header-wrap')).height).toBe(HEADER_BAR_H + TITLE_BLOCK_H);
    }
  });

  it('expandido no se mueve; colapsado sube el alto del bloque título', () => {
    const r0 = render(<CollapsibleHeader title="X" progress={crearProgress(0)} />);
    expect(translateY(r0.getByTestId('header-wrap'))).toBe(0);
    const r1 = render(<CollapsibleHeader title="X" progress={crearProgress(1)} />);
    expect(translateY(r1.getByTestId('header-wrap'))).toBe(-TITLE_BLOCK_H);
  });

  it('el mármol compensa el traslado: la textura no se mueve en pantalla', () => {
    const r = render(<CollapsibleHeader title="X" progress={crearProgress(1)} />);
    const ancla = r.getByTestId('header-marmol-ancla', { includeHiddenElements: true });
    expect(translateY(r.getByTestId('header-wrap')) + translateY(ancla)).toBe(0);
  });

  it('colapsado, el bloque título salió entero de su ventana de recorte', () => {
    const r = render(<CollapsibleHeader title="X" subtitle="Hola" progress={crearProgress(1)} />);
    const movil = r.getByTestId('header-title-block-movil');
    expect(translateY(movil)).toBe(-TITLE_BLOCK_H);
  });
});
