import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, renderHook, screen } from '@testing-library/react-native';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';

import { Fab, FabRow, FAB_BOTTOM_GAP, separacionInferiorDelFab } from '@/src/components/Fab';
import { TabBarFondoAero } from '@/src/components/skin/TabBarFondoAero';
import { TabBarFondoClasico } from '@/src/components/skin/TabBarFondoClasico';
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
  Tabs.Screen = function Screen() { return null; };
  return { Tabs };
});

jest.mock('expo-blur', () => {
  const R = require('react');
  const { View } = require('react-native');
  return { BlurView: (p: any) => R.createElement(View, { ...p, testID: 'blur-view' }) };
});

// eslint-disable-next-line import/first
import TabLayout from '@/app/(tabs)/_layout';

const ALTO_BARRA = 100;
const enPestanas = (ui: React.ReactElement) => (
  <BottomTabBarHeightContext.Provider value={ALTO_BARRA}>{ui}</BottomTabBarHeightContext.Provider>
);

describe.each(['default', 'aero'] as const)('barra de pestañas con skin %s', skinId => {
  beforeEach(() => useSettingsStore.setState({ skin: skinId, reduceAnimations: true }));

  it('la barra flota (absoluta) sobre el contenido en ambos skins (T-276)', () => {
    render(<TabLayout />);
    const estilo = StyleSheet.flatten(opciones.tabBarStyle);
    expect(estilo.position).toBe('absolute');
    expect(opciones.tabBarBackground).toBeDefined();
  });

  it('el alto de la barra es la huella de la píldora, sin pasarse de 86 en iPhone', () => {
    render(<TabLayout />);
    expect(StyleSheet.flatten(opciones.tabBarStyle).height).toBeLessThanOrEqual(86);
  });

  it('las pestañas dejan lugar abajo para la barra en ambos skins', () => {
    const { result } = renderHook(() => useRellenoBarraPestanas(), {
      wrapper: ({ children }) => enPestanas(<>{children}</>),
    });
    expect(result.current).toBe(ALTO_BARRA);
  });

  it('el FAB de las pestañas queda por encima de la barra', () => {
    render(enPestanas(
      <FabRow><Fab testID="fab" onPress={() => {}} icon="add" backgroundColor="#000" /></FabRow>,
    ));
    const fila = screen.getByTestId('fab-row');
    const bottom = StyleSheet.flatten(fila.props.style).bottom;
    expect(bottom).toBe(ALTO_BARRA + FAB_BOTTOM_GAP);
  });
});

describe('separacionInferiorDelFab con barra flotante', () => {
  it('suma el alto de la barra cuando flota', () => {
    expect(separacionInferiorDelFab({ dentroDePestanas: true, baseInferior: 36, barraFlotante: 90 }))
      .toBe(FAB_BOTTOM_GAP + 90);
  });
});

describe('fondos de la píldora', () => {
  it('Aero dibuja la píldora', () => {
    useSettingsStore.setState({ skin: 'aero', reduceAnimations: true });
    render(<TabBarFondoAero bottom={22} alto={62} margen={16} />);
    expect(screen.getByTestId('tabbar-aero', { includeHiddenElements: true })).toBeTruthy();
  });

  it('Clásico dibuja la píldora', () => {
    useSettingsStore.setState({ skin: 'default', reduceAnimations: true });
    render(<TabBarFondoClasico bottom={22} alto={62} margen={16} />);
    expect(screen.getByTestId('tabbar-clasico', { includeHiddenElements: true })).toBeTruthy();
  });
});

describe('las cinco pestañas reservan el alto de la barra abajo', () => {
  it.each(['index', 'groups', 'friends', 'activity', 'user'])('%s usa useRellenoBarraPestanas', nombre => {
    const src = readFileSync(join(__dirname, '..', '..', '..', '..', 'app', '(tabs)', `${nombre}.tsx`), 'utf8');
    expect(src).toMatch(/useRellenoBarraPestanas\(\)/);
  });
});

/** T-292: el vidrio es caro; en toda la barra hay como mucho UN BlurView y en Android ninguno. */
describe('vidrio de la barra de pestañas (T-292)', () => {
  const original = Platform.OS;
  const enPlataforma = (os: 'ios' | 'android') => { Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true }); };
  afterEach(() => { Object.defineProperty(Platform, 'OS', { get: () => original, configurable: true }); });
  beforeEach(() => useSettingsStore.setState({ skin: 'aero', reduceAnimations: false }));

  it('iOS: el fondo de la barra monta un solo BlurView', () => {
    enPlataforma('ios');
    render(<TabLayout />);
    render(<>{opciones.tabBarBackground()}</>);
    expect(screen.getAllByTestId('blur-view', { includeHiddenElements: true }).length).toBe(1);
  });

  it('Android: el fondo de la barra no monta BlurView', () => {
    enPlataforma('android');
    render(<TabLayout />);
    render(<>{opciones.tabBarBackground()}</>);
    expect(screen.queryByTestId('blur-view', { includeHiddenElements: true })).toBeNull();
  });
});
