import React from 'react';
import { StyleSheet } from 'react-native';
import { render, renderHook, screen } from '@testing-library/react-native';

import { DetailHeader, useRellenoDetailHeader } from '@/src/components/CollapsibleHeader';
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
