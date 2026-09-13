import React from 'react';
import fs from 'fs';
import path from 'path';
import { Text } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { render, renderHook, within } from '@testing-library/react-native';
import {
  CollapsibleHeader, useHeaderPadding, HEADER_BAR_H, TITLE_BLOCK_H, HEADER_TOTAL_H_T114, FACTOR_ALTO_HEADER, TITLE_BOTTOM_GAP,
} from '../CollapsibleHeader';

/**
 * T-128 (PO 2026-09-13) — header colapsable al scrollear. Reemplaza la spec
 * de T-114/T-125/T-126 en lo que toca:
 *
 * - `scrollY: Animated.Value` (React Native) → `progress: SharedValue<number>`
 *   (Reanimated, en [0,1]), ya calculado por `useHeaderColapsable`.
 * - Se saca el velo (`bgOpacity`/`hairOpacity` de T-105/T-110) que tapaba el
 *   mármol al scrollear: el PO lo declaró invariante — el mármol NUNCA
 *   desaparece, en ningún estado. El header es opaco por la propia textura
 *   (JPEG opaco), no por un tinte encima.
 * - El bloque título (saludo + título grande) NO tiene fade ni traslado
 *   propio (corrección del PO): sólo queda recortado por el `overflow`
 *   hidden del header a medida que este pierde alto. Se verifica con
 *   `alturaBloqueTituloVisible`, no con opacidad.
 * - El título chico junto a la foto de perfil SÍ tiene fade propio,
 *   sincronizado con el progreso.
 */

function crearProgress(valor: number) {
  return renderHook(() => useSharedValue(valor)).result.current;
}

function Probe({ aire }: { aire?: number }) {
  const pad = useHeaderPadding(aire);
  return <Text testID="pad">{pad}</Text>;
}

describe('CollapsibleHeader — bloque título (T-114/T-125/T-126, vigente)', () => {
  it('el título queda a no más de 6pt del borde inferior del header (T-126)', () => {
    expect(TITLE_BOTTOM_GAP).toBeLessThanOrEqual(6);
  });

  it('el header mide el doble y un poco más que el de T-114 (×2,2, T-125)', () => {
    expect(HEADER_BAR_H + TITLE_BLOCK_H).toBe(Math.round(HEADER_TOTAL_H_T114 * FACTOR_ALTO_HEADER));
    expect(HEADER_BAR_H + TITLE_BLOCK_H).toBeGreaterThan(2 * HEADER_TOTAL_H_T114);
  });

  it('useHeaderPadding incluye el nuevo alto del bloque título', () => {
    const r = render(<Probe aire={16} />);
    expect(Number(r.getByTestId('pad').props.children)).toBe(HEADER_BAR_H + TITLE_BLOCK_H + 16);
  });

  it('sin subtítulo, sólo se ve el título', () => {
    const progress = crearProgress(0);
    const r = render(<CollapsibleHeader title="Tus cuentas" progress={progress} />);
    expect(r.getAllByText('Tus cuentas').length).toBeGreaterThan(0);
    expect(r.queryByTestId('header-subtitle')).toBeNull();
  });

  it('con subtítulo, aparece ARRIBA del título, dentro del mismo bloque', () => {
    const progress = crearProgress(0);
    const r = render(
      <CollapsibleHeader title="Tus cuentas" subtitle="Hola, Ana" progress={progress} />,
    );
    const bloque = r.getByTestId('header-title-block');
    const textos = within(bloque).getAllByText(/.+/).map(n => n.props.children);
    expect(textos).toEqual(['Hola, Ana', 'Tus cuentas']);
  });

  it('el bloque título grande se ve siempre en reposo — no depende de haber scrolleado para aparecer', () => {
    const progress = crearProgress(0);
    const r = render(<CollapsibleHeader title="Actividad" progress={progress} />);
    const bloque = r.getByTestId('header-title-block');
    expect(within(bloque).getByText('Actividad')).toBeTruthy();
  });

  it('el título y el subtítulo no cambian entre reposo y colapsado (misma pantalla, sin duplicar contenido)', () => {
    const progress = crearProgress(0);
    const r = render(<CollapsibleHeader title="Tus cuentas" subtitle="Hola, Ana" progress={progress} />);
    expect(r.getAllByText('Tus cuentas').length).toBeGreaterThan(0);
    expect(r.getAllByText('Hola, Ana')).toHaveLength(1); // el saludo no se duplica en la fila chica
  });
});

describe('CollapsibleHeader — colapso al scrollear (T-128)', () => {
  it('con progreso 0 el header mide el alto expandido', () => {
    const progress = crearProgress(0);
    const r = render(<CollapsibleHeader title="Tus cuentas" progress={progress} />);
    const wrap = r.getByTestId('header-wrap');
    const flat = Array.isArray(wrap.props.style) ? Object.assign({}, ...wrap.props.style.flat(Infinity)) : wrap.props.style;
    expect(flat.height).toBe(HEADER_BAR_H + TITLE_BLOCK_H);
  });

  it('con progreso 1 el header mide sólo la fila de botones (sin insets en test, insets.top = 0)', () => {
    const progress = crearProgress(1);
    const r = render(<CollapsibleHeader title="Tus cuentas" progress={progress} />);
    const wrap = r.getByTestId('header-wrap');
    const flat = Array.isArray(wrap.props.style) ? Object.assign({}, ...wrap.props.style.flat(Infinity)) : wrap.props.style;
    expect(flat.height).toBe(HEADER_BAR_H);
  });

  it('el título chico junto a la foto de perfil arranca invisible (progreso 0)', () => {
    const progress = crearProgress(0);
    const r = render(<CollapsibleHeader title="Tus cuentas" progress={progress} />);
    const chico = r.getByTestId('header-title-compact');
    const flat = Array.isArray(chico.props.style) ? Object.assign({}, ...chico.props.style.flat(Infinity)) : chico.props.style;
    expect(flat.opacity).toBe(0);
  });

  it('el título chico se ve del todo con el header colapsado (progreso 1)', () => {
    const progress = crearProgress(1);
    const r = render(<CollapsibleHeader title="Tus cuentas" progress={progress} />);
    const chico = r.getByTestId('header-title-compact');
    const flat = Array.isArray(chico.props.style) ? Object.assign({}, ...chico.props.style.flat(Infinity)) : chico.props.style;
    expect(flat.opacity).toBe(1);
  });

  it('en Inicio (con subtítulo) el saludo no tiene fade propio: es el mismo bloque título, recortado por el header — con progreso 1 el contenedor que lo recorta mide 0', () => {
    const progress = crearProgress(1);
    const r = render(<CollapsibleHeader title="Tus cuentas" subtitle="Hola, Ana" progress={progress} />);
    const recorte = r.getByTestId('header-title-block-clip');
    const flat = Array.isArray(recorte.props.style) ? Object.assign({}, ...recorte.props.style.flat(Infinity)) : recorte.props.style;
    expect(flat.height).toBe(0);
  });

  it('el bloque título grande no usa Animated.Text con opacidad propia (sin fade independiente, pedido del PO)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../CollapsibleHeader.tsx'), 'utf8');
    // El único elemento con opacidad animada por progreso debe ser el título
    // chico compacto (`header-title-compact`) y el hairline; el bloque título
    // grande (`header-title-block`) no puede llevar un `useAnimatedStyle` de
    // opacidad propio.
    const bloque = src.slice(src.indexOf('titleBlock'), src.indexOf('titleBlock') + 800);
    expect(bloque).not.toMatch(/opacity:\s*(titleOpacity|tituloOpacity)/);
  });
});

describe('CollapsibleHeader — invariante del mármol (T-128, PO): NUNCA desaparece', () => {
  it('el mármol se renderiza siempre, con progreso 0 y con progreso 1', () => {
    for (const p of [0, 0.5, 1]) {
      const progress = crearProgress(p);
      const r = render(<CollapsibleHeader title="X" progress={progress} />);
      // `FondoMarmol` es `accessibilityElementsHidden` (a propósito, es
      // decorativo) — sin `includeHiddenElements` las queries de RNTL lo
      // excluyen por defecto y no encuentran nada, pero SÍ está en el árbol.
      expect(r.getByTestId('fondo-marmol', { includeHiddenElements: true })).toBeTruthy();
    }
  });

  it('el mármol nunca lleva opacidad menor a 1 en su propio estilo, en ningún progreso', () => {
    for (const p of [0, 0.3, 0.6, 1]) {
      const progress = crearProgress(p);
      const r = render(<CollapsibleHeader title="X" progress={progress} />);
      const marmol = r.getByTestId('fondo-marmol', { includeHiddenElements: true });
      const flat = Array.isArray(marmol.props.style)
        ? Object.assign({}, ...marmol.props.style.flat(Infinity))
        : marmol.props.style;
      expect(flat.opacity === undefined || flat.opacity === 1).toBe(true);
    }
  });

  it('guard de código fuente: CollapsibleHeader no vuelve a montar el velo de T-105/T-110 tapando el mármol', () => {
    const srcConComentarios = fs.readFileSync(path.join(__dirname, '../CollapsibleHeader.tsx'), 'utf8');
    // Sacamos comentarios de bloque y de línea antes de buscar: la prosa de
    // arriba EXPLICA por qué se sacó el velo viejo (nombra su variable a
    // propósito), y un guard que la lea como código se auto-rompería.
    const sinComentarios = srcConComentarios.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // Sólo la parte de `CollapsibleHeader` (el header de las tabs, el que
    // colapsa): `DetailHeader`, más abajo en el mismo archivo, NO cambia en
    // T-128 y sigue con su propio tinte fijo sobre el mármol (a propósito,
    // documentado ahí — no tiene alto animado que lo vaya destapando solo).
    const src = sinComentarios.slice(0, sinComentarios.indexOf('export function DetailHeader'));
    expect(src).not.toMatch(/bgOpacity/);
    expect(src).not.toMatch(/hairOpacity/);
    // Ninguna capa opaca (backgroundColor + opacity animada) por encima del mármol.
    expect(src).not.toMatch(/backgroundColor:\s*c\.bg,\s*opacity:/);
  });

  it('guard de código fuente: ninguna de las seis tabs sigue mandando el velo viejo (Animated.Value de React Native para el header)', () => {
    const tabsDir = path.join(__dirname, '../../../app/(tabs)');
    const archivos = fs.readdirSync(tabsDir).filter(f => f.endsWith('.tsx') && f !== '_layout.tsx');
    for (const f of archivos) {
      const src = fs.readFileSync(path.join(tabsDir, f), 'utf8');
      expect(src).not.toMatch(/useNativeDriver:\s*false/);
    }
  });
});
