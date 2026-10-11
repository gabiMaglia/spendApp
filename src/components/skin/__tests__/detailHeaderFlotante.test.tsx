import React from 'react';
import { StyleSheet } from 'react-native';
import { render, renderHook, screen } from '@testing-library/react-native';

import { DetailHeader, EnModal, useRellenoDetailHeader } from '@/src/components/CollapsibleHeader';

// Inset de arriba controlable por test (el mock global lo deja en 0).
let mockTop = 0;
jest.mock('react-native-safe-area-context', () => {
  const real = jest.requireActual('react-native-safe-area-context');
  return {
    ...real,
    useSafeAreaInsets: () => ({ top: mockTop, bottom: 0, left: 0, right: 0 }),
    __setTop: (n: number) => { mockTop = n; },
  };
});
import { useSettingsStore } from '@/src/store/settingsStore';

/**
 * T-227 punto 5 (PO 2026-09-29): en Aero el header de las pantallas de
 * detalle es transparente como el de las pestañas — flota sobre el contenido
 * con el velo detrás, y el contenido pasa por debajo. En Clásico no cambia.
 */
describe.each(['default', 'aero'] as const)('DetailHeader con skin %s', skinId => {
  const aero = skinId === 'aero';
  beforeEach(() => useSettingsStore.setState({ skin: skinId, reduceAnimations: true }));

  it(aero ? 'flota sobre el contenido' : 'sigue en el flujo', () => {
    render(<DetailHeader title="X" onBack={() => {}} />);
    const capa = screen.queryByTestId('detail-header-flota', { includeHiddenElements: true });
    if (!aero) {
      expect(capa).toBeNull();
      return;
    }
    expect(StyleSheet.flatten(capa!.props.style).position).toBe('absolute');
    // La capa deja pasar los toques al contenido; la tarjeta los recibe.
    expect(capa!.props.pointerEvents).toBe('box-none');
  });

  it(aero ? 'dibuja el velo detrás de la tarjeta' : 'no dibuja velo', () => {
    render(<DetailHeader title="X" onBack={() => {}} />);
    expect(!!screen.queryByTestId('velo-detail-header', { includeHiddenElements: true })).toBe(aero);
  });

  it(aero ? 'el contenido tiene que bajar debajo de la tarjeta' : 'el contenido no baja nada', () => {
    const { result } = renderHook(() => useRellenoDetailHeader());
    if (aero) expect(result.current).toBeGreaterThan(0);
    else expect(result.current).toBe(0);
  });
});

/**
 * feat/reskin (PO 2026-10-11): en iOS un modal se abre como hoja y ya arranca
 * debajo de la barra de estado; sumarle el inset de arriba dejaba el chip
 * «Nuevo gasto» flotando muy abajo. Dentro de `EnModal` el header de Aero no
 * suma ese inset. Android (modal a pantalla completa) y Clásico no cambian.
 */
describe('DetailHeader de Aero dentro de un modal', () => {
  beforeEach(() => useSettingsStore.setState({ skin: 'aero', reduceAnimations: true }));
  const INSET = 47;
  const insets = jest.requireMock('react-native-safe-area-context') as { __setTop?: (n: number) => void };

  it('en iOS el contenido baja el inset de arriba menos', () => {
    insets.__setTop?.(INSET);
    const fuera = renderHook(() => useRellenoDetailHeader()).result.current;
    const dentro = renderHook(() => useRellenoDetailHeader(), { wrapper: EnModal }).result.current;
    expect(fuera - dentro).toBe(INSET);
  });

  it('en Android no cambia', () => {
    insets.__setTop?.(INSET);
    const { Platform } = jest.requireActual('react-native') as typeof import('react-native');
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    try {
      const fuera = renderHook(() => useRellenoDetailHeader()).result.current;
      const dentro = renderHook(() => useRellenoDetailHeader(), { wrapper: EnModal }).result.current;
      expect(dentro).toBe(fuera);
    } finally {
      Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
    }
  });
});
