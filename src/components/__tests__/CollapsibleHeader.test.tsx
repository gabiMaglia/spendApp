import React from 'react';
import { Animated, Text } from 'react-native';
import { render, within } from '@testing-library/react-native';
import {
  CollapsibleHeader, useHeaderPadding, HEADER_BAR_H, TITLE_BLOCK_H, HEADER_TOTAL_H_T114, FACTOR_ALTO_HEADER, TITLE_BOTTOM_GAP,
} from '../CollapsibleHeader';

/**
 * T-114 (PO 2026-09-13) — header único con:
 * 1. Fila de botones (izquierda/derecha) arriba, bloque título abajo,
 *    `justifyContent: 'space-between'` entre las dos.
 * 2. El bloque saludo+título ya NO scrollea ni aparece recién al hacer
 *    scroll (antes era un `Animated.Text` con opacidad atada a `scrollY`,
 *    doble del que vivía en el contenido de cada pantalla) — ahora es el
 *    ÚNICO título, siempre visible.
 * 3. Alto del bloque título +2/3 (×1,667) respecto de la línea compacta de
 *    hoy: el header total es ×2,2 el de T-114 (T-125).
 */

function Probe({ aire }: { aire?: number }) {
  const pad = useHeaderPadding(aire);
  return <Text testID="pad">{pad}</Text>;
}

describe('CollapsibleHeader — bloque título (T-114)', () => {
  it('el título queda a no más de 6pt del borde inferior del header (T-126)', () => {
    expect(TITLE_BOTTOM_GAP).toBeLessThanOrEqual(6);
  });

  it('el header mide el doble y un poco más que el de T-114 (×2,2, T-125)', () => {
    // Cambio de spec del PO: antes el bloque título crecía ×1,667 sobre una línea compacta.
    expect(HEADER_BAR_H + TITLE_BLOCK_H).toBe(Math.round(HEADER_TOTAL_H_T114 * FACTOR_ALTO_HEADER));
    expect(HEADER_BAR_H + TITLE_BLOCK_H).toBeGreaterThan(2 * HEADER_TOTAL_H_T114);
  });

  it('useHeaderPadding incluye el nuevo alto del bloque título', () => {
    const r = render(<Probe aire={16} />);
    // En test (sin insets nativos) `insets.top` es 0: el padding es la suma
    // de los tres términos, sin adivinar el inset real del dispositivo.
    expect(Number(r.getByTestId('pad').props.children)).toBe(HEADER_BAR_H + TITLE_BLOCK_H + 16);
  });

  it('sin subtítulo, sólo se ve el título', () => {
    const r = render(<CollapsibleHeader title="Tus cuentas" scrollY={new Animated.Value(0)} />);
    expect(r.getByText('Tus cuentas')).toBeTruthy();
    expect(r.queryByTestId('header-subtitle')).toBeNull();
  });

  it('con subtítulo, aparece ARRIBA del título, dentro del mismo bloque', () => {
    const r = render(
      <CollapsibleHeader title="Tus cuentas" subtitle="Hola, Ana" scrollY={new Animated.Value(0)} />,
    );
    const bloque = r.getByTestId('header-title-block');
    const textos = within(bloque).getAllByText(/.+/).map(n => n.props.children);
    expect(textos).toEqual(['Hola, Ana', 'Tus cuentas']);
  });

  it('el título se ve SIEMPRE — no es un Animated.Text que aparece recién al scrollear', () => {
    // Antes el título vivía en un `Animated.Text` con opacidad atada a
    // `scrollY` (0 en reposo): ahora es el único título de la pantalla y no
    // puede depender de scrollear para hacerse visible.
    const enReposo   = render(<CollapsibleHeader title="Actividad" scrollY={new Animated.Value(0)} />);
    const scrolleado = render(<CollapsibleHeader title="Actividad" scrollY={new Animated.Value(200)} />);

    expect(enReposo.getByText('Actividad')).toBeTruthy();
    expect(scrolleado.getByText('Actividad')).toBeTruthy();
    expect(enReposo.UNSAFE_queryAllByType(Animated.Text).some(n => n.props.children === 'Actividad'))
      .toBe(false);
  });

  it('el título y el subtítulo no cambian entre reposo y scroll (misma pantalla, sin duplicar contenido)', () => {
    const scrollY = new Animated.Value(0);
    const r = render(<CollapsibleHeader title="Tus cuentas" subtitle="Hola, Ana" scrollY={scrollY} />);
    expect(r.getAllByText('Tus cuentas')).toHaveLength(1);
    expect(r.getAllByText('Hola, Ana')).toHaveLength(1);
  });
});
