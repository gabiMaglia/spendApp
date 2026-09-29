import React from 'react';
import { StyleSheet } from 'react-native';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, renderHook, screen } from '@testing-library/react-native';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';

import { Fab, FabRow, FAB_BOTTOM_GAP, separacionInferiorDelFab } from '@/src/components/Fab';
import { TabBarFondoAero, VELO_BARRA_OPACIDAD } from '@/src/components/skin/TabBarFondoAero';
import { VELO_OPACIDAD } from '@/src/components/skin/VeloHeader';
import { useRellenoBarraPestanas } from '@/src/hooks/useRellenoBarraPestanas';
import { useSettingsStore } from '@/src/store/settingsStore';

/**
 * T-227 punto 9 (PO 2026-09-29): en Aero la barra de pestañas flota sobre el
 * contenido con un velo denso detrás (el «blur muchísimo más intenso» que el
 * del header — sin blur nativo, que crashea en Android 11). Lo que flota
 * abajo (FABs) sigue quedando arriba de la barra. En Clásico, igual que hoy.
 */
let opciones: Record<string, any> = {};
jest.mock('expo-router', () => {
  const Tabs = (p: { screenOptions: Record<string, any> }) => { opciones = p.screenOptions; return null; };
  Tabs.Screen = () => null;
  return { Tabs };
});

// eslint-disable-next-line import/first
import TabLayout from '@/app/(tabs)/_layout';

const ALTO_BARRA = 100;
const enPestanas = (ui: React.ReactElement) => (
  <BottomTabBarHeightContext.Provider value={ALTO_BARRA}>{ui}</BottomTabBarHeightContext.Provider>
);

describe.each(['default', 'aero'] as const)('barra de pestañas con skin %s', skinId => {
  const aero = skinId === 'aero';
  beforeEach(() => useSettingsStore.setState({ skin: skinId, reduceAnimations: true }));

  it(aero ? 'la barra flota (absoluta) sobre el contenido' : 'la barra sigue en el flujo', () => {
    render(<TabLayout />);
    const estilo = StyleSheet.flatten(opciones.tabBarStyle);
    if (aero) expect(estilo.position).toBe('absolute');
    else expect(estilo.position).toBeUndefined();
  });

  it(aero ? 'las pestañas dejan lugar abajo para la barra' : 'las pestañas no suman nada', () => {
    const { result } = renderHook(() => useRellenoBarraPestanas(), {
      wrapper: ({ children }) => enPestanas(<>{children}</>),
    });
    expect(result.current).toBe(aero ? ALTO_BARRA : 0);
  });

  it('el FAB de las pestañas queda por encima de la barra', () => {
    render(enPestanas(
      <FabRow><Fab testID="fab" onPress={() => {}} icon="add" backgroundColor="#000" /></FabRow>,
    ));
    const fila = screen.getByTestId('fab-row');
    const bottom = StyleSheet.flatten(fila.props.style).bottom;
    // En Clásico la barra no es absoluta: `bottom` ya se mide desde su borde.
    expect(bottom).toBe(aero ? ALTO_BARRA + FAB_BOTTOM_GAP : FAB_BOTTOM_GAP);
  });
});

describe('separacionInferiorDelFab con barra flotante', () => {
  it('suma el alto de la barra cuando flota', () => {
    expect(separacionInferiorDelFab({ dentroDePestanas: true, insetInferior: 48, barraFlotante: 90 }))
      .toBe(FAB_BOTTOM_GAP + 90);
  });
});

describe('TabBarFondoAero', () => {
  beforeEach(() => useSettingsStore.setState({ skin: 'aero', reduceAnimations: true }));

  it('dibuja el velo denso en vez del fondo opaco', () => {
    render(<TabBarFondoAero inferior={24} />);
    expect(screen.getByTestId('velo-barra', { includeHiddenElements: true })).toBeTruthy();
  });

  it('el velo de la barra es mucho más denso que el del header, sin llegar a tapar', () => {
    expect(VELO_BARRA_OPACIDAD).toBeGreaterThan(VELO_OPACIDAD * 2);
    expect(VELO_BARRA_OPACIDAD).toBeLessThan(1);
  });
});

describe('las cinco pestañas reservan el alto de la barra abajo', () => {
  it.each(['index', 'groups', 'friends', 'activity', 'user'])('%s usa useRellenoBarraPestanas', nombre => {
    const src = readFileSync(join(__dirname, '..', '..', '..', '..', 'app', '(tabs)', `${nombre}.tsx`), 'utf8');
    expect(src).toMatch(/useRellenoBarraPestanas\(\)/);
  });
});
