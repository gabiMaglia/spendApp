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

  // Guard de assets: si algún día alguien mueve o renombra las texturas del
  // Orquestador, este test avisa ANTES de que el header quede en blanco.
  it('las texturas viven en assets/images', () => {
    const raiz = join(__dirname, '..', '..', '..');
    expect(existsSync(join(raiz, 'assets/images/marmol-claro.jpg'))).toBe(true);
    expect(existsSync(join(raiz, 'assets/images/marmol-oscuro.jpg'))).toBe(true);
  });
});
