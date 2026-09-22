import React from 'react';
import { existsSync } from 'fs';
import { join } from 'path';
import { render } from '@testing-library/react-native';
import { Image } from 'expo-image';

import { useThemeStore } from '@/src/store/themeStore';

/**
 * T-105 — el mármol de fondo de los headers.
 *
 * Pedido del PO: una textura clara y una oscura, elegidas según el tema, fija
 * (no animada). El componente es el único lugar que sabe cuál imagen usar —
 * los headers sólo lo montan.
 *
 * Los dos `.jpg` se mockean con marcadores distintos porque bajo Jest CUALQUIER
 * imagen se transforma al mismo valor (`assetFileTransformer` de RN devuelve
 * literalmente `1` para toda extensión de asset) — sin esto, claro y oscuro
 * serían indistinguibles en el test aunque el componente elija bien.
 */
jest.mock('../../../assets/images/marmol-claro.jpg', () => 'ASSET_MARMOL_CLARO', { virtual: true });
jest.mock('../../../assets/images/marmol-oscuro.jpg', () => 'ASSET_MARMOL_OSCURO', { virtual: true });
jest.mock('../../../assets/images/marmol-claro-distendido.jpg', () => 'ASSET_MARMOL_CLARO_DISTENDIDO', { virtual: true });
jest.mock('../../../assets/images/marmol-oscuro-distendido.jpg', () => 'ASSET_MARMOL_OSCURO_DISTENDIDO', { virtual: true });
jest.mock('../../../assets/images/marmol-claro-franja.jpg', () => 'ASSET_MARMOL_CLARO_FRANJA', { virtual: true });
jest.mock('../../../assets/images/marmol-oscuro-franja.jpg', () => 'ASSET_MARMOL_OSCURO_FRANJA', { virtual: true });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FondoMarmol } = require('../FondoMarmol');

describe('FondoMarmol', () => {
  beforeEach(() => {
    useThemeStore.setState({ themeChoice: 'auto' });
  });

  it('en tema claro usa la textura clara', () => {
    useThemeStore.setState({ themeChoice: 'light' });
    const r = render(<FondoMarmol />);
    expect(r.UNSAFE_getByType(Image).props.source).toBe('ASSET_MARMOL_CLARO');
  });

  it('en tema oscuro usa la textura oscura', () => {
    useThemeStore.setState({ themeChoice: 'dark' });
    const r = render(<FondoMarmol />);
    expect(r.UNSAFE_getByType(Image).props.source).toBe('ASSET_MARMOL_OSCURO');
  });

  // PO: "estirá la imagen para que se adapte al alto del header, que no se
  // vean pedacitos nomás" — `fill` en vez de `cover`, para que entre la
  // textura COMPLETA (todas las vetas + el fundido de abajo) sin importar
  // cuánto mida la superficie del header (fijo o colapsable).
  it('estira la imagen al tamaño exacto del header (fill), sin capturar toques ni lectores de pantalla', () => {
    useThemeStore.setState({ themeChoice: 'light' });
    const r = render(<FondoMarmol />);
    const img = r.UNSAFE_getByType(Image);
    expect(img.props.contentFit).toBe('fill');
    expect(img.props.pointerEvents).toBe('none');
    expect(img.props.accessibilityElementsHidden).toBe(true);
  });

  // T-137: dos superficies pegadas con el mismo `FondoMarmol` se leían como la
  // misma foto repetida — `variante` espeja en X la MISMA textura, sin asset
  // nuevo, para que la de "Movimientos" no calque literal a la del header.
  it('con `variante`, espeja la textura en X (mismo asset, mismo grosor de veta)', () => {
    useThemeStore.setState({ themeChoice: 'light' });
    const r = render(<FondoMarmol variante />);
    const img = r.UNSAFE_getByType(Image);
    const flat = [img.props.style].flat(Infinity);
    expect(flat).toContainEqual({ transform: [{ scaleX: -1 }] });
  });

  it('sin `variante`, no aplica ninguna transformación', () => {
    useThemeStore.setState({ themeChoice: 'light' });
    const r = render(<FondoMarmol />);
    const img = r.UNSAFE_getByType(Image);
    const flat = [img.props.style].flat(Infinity);
    expect(flat.some((s: unknown) => s && typeof s === 'object' && 'transform' in s)).toBe(false);
  });

  // Guard de assets: si algún día alguien mueve o renombra las texturas del
  // Orquestador, este test avisa ANTES de que el header quede en blanco.
  it('las texturas viven en assets/images', () => {
    const raiz = join(__dirname, '..', '..', '..');
    expect(existsSync(join(raiz, 'assets/images/marmol-claro.jpg'))).toBe(true);
    expect(existsSync(join(raiz, 'assets/images/marmol-oscuro.jpg'))).toBe(true);
  });

  // T-137-quater: segundo patrón (Contactos) — mismo shader, más espaciado y
  // tenue, para no repetir la textura del header/Movimientos.
  describe('patron="distendida"', () => {
    it('en tema claro usa la textura clara distendida', () => {
      useThemeStore.setState({ themeChoice: 'light' });
      const r = render(<FondoMarmol patron="distendida" />);
      expect(r.UNSAFE_getByType(Image).props.source).toBe('ASSET_MARMOL_CLARO_DISTENDIDO');
    });

    it('en tema oscuro usa la textura oscura distendida', () => {
      useThemeStore.setState({ themeChoice: 'dark' });
      const r = render(<FondoMarmol patron="distendida" />);
      expect(r.UNSAFE_getByType(Image).props.source).toBe('ASSET_MARMOL_OSCURO_DISTENDIDO');
    });

    it('sin `patron`, sigue usando la textura de siempre (default "header")', () => {
      useThemeStore.setState({ themeChoice: 'light' });
      const r = render(<FondoMarmol />);
      expect(r.UNSAFE_getByType(Image).props.source).toBe('ASSET_MARMOL_CLARO');
    });

    it('las texturas distendidas viven en assets/images', () => {
      const raiz = join(__dirname, '..', '..', '..');
      expect(existsSync(join(raiz, 'assets/images/marmol-claro-distendido.jpg'))).toBe(true);
      expect(existsSync(join(raiz, 'assets/images/marmol-oscuro-distendido.jpg'))).toBe(true);
    });
  });

  // T-137-sexies: tercer patrón (navegador de mes en Personal, total de
  // Grupos) — otra semilla de dominio, para franjas angostas que conviven en
  // la misma pantalla con una de las otras dos texturas.
  describe('patron="franja"', () => {
    it('en tema claro usa la textura clara de franja', () => {
      useThemeStore.setState({ themeChoice: 'light' });
      const r = render(<FondoMarmol patron="franja" />);
      expect(r.UNSAFE_getByType(Image).props.source).toBe('ASSET_MARMOL_CLARO_FRANJA');
    });

    it('en tema oscuro usa la textura oscura de franja', () => {
      useThemeStore.setState({ themeChoice: 'dark' });
      const r = render(<FondoMarmol patron="franja" />);
      expect(r.UNSAFE_getByType(Image).props.source).toBe('ASSET_MARMOL_OSCURO_FRANJA');
    });

    it('las texturas de franja viven en assets/images', () => {
      const raiz = join(__dirname, '..', '..', '..');
      expect(existsSync(join(raiz, 'assets/images/marmol-claro-franja.jpg'))).toBe(true);
      expect(existsSync(join(raiz, 'assets/images/marmol-oscuro-franja.jpg'))).toBe(true);
    });
  });
});
