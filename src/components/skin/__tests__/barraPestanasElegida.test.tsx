import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';

import { useSettingsStore } from '@/src/store/settingsStore';

/**
 * T-227 punto 10 (PO 2026-09-29): «da una impresión rara cómo está el
 * elegido». En Aero la pestaña elegida se marca como en las pestañas
 * `Segmented` del Aero — una píldora detrás del ícono y el label — y sin la
 * rayita debajo del label. En Clásico sigue la rayita (el punto).
 */
type Opciones = Record<string, any>;
let mockScreenOptions: Opciones = {};
let mockHijos: React.ReactElement[] = [];
jest.mock('expo-router', () => {
  const Tabs = (p: { screenOptions: Opciones; children: React.ReactNode }) => {
    mockScreenOptions = p.screenOptions;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mockHijos = require('react').Children.toArray(p.children);
    return null;
  };
  Tabs.Screen = function Screen() { return null; };
  return { Tabs };
});

// eslint-disable-next-line import/first
import TabLayout from '@/app/(tabs)/_layout';

// El botón de la barra usa el tema de navegación, como dentro de la app.
const conTema = (ui: React.ReactElement) => <ThemeProvider value={DefaultTheme}>{ui}</ThemeProvider>;

function opcionesDe(nombre: string): Opciones {
  const el = mockHijos.find(h => (h.props as { name: string }).name === nombre)!;
  return (el.props as { options: Opciones }).options;
}

describe.each(['default', 'aero'] as const)('pestaña elegida con skin %s', skinId => {
  const aero = skinId === 'aero';
  beforeEach(() => {
    useSettingsStore.setState({ skin: skinId, reduceAnimations: true });
    render(<TabLayout />);
  });

  it(aero ? 'sin rayita debajo del label' : 'con la rayita debajo del label', () => {
    render(<>{opcionesDe('index').tabBarLabel({ focused: true })}</>);
    expect(!!screen.queryByTestId('tab-indicador', { includeHiddenElements: true })).toBe(!aero);
  });

  it(aero ? 'la elegida lleva la píldora detrás de ícono y label' : 'sin píldora', () => {
    const Boton = mockScreenOptions.tabBarButton;
    render(conTema(<Boton aria-selected><Text>Personal</Text></Boton>));
    const pildora = screen.queryByTestId('tab-pildora', { includeHiddenElements: true });
    expect(!!pildora).toBe(aero);
    if (aero) expect(screen.getByText('Personal')).toBeTruthy();
  });

  it('una pestaña no elegida nunca lleva píldora', () => {
    const Boton = mockScreenOptions.tabBarButton;
    render(conTema(<Boton aria-selected={false}><Text>Grupos</Text></Boton>));
    expect(screen.queryByTestId('tab-pildora', { includeHiddenElements: true })).toBeNull();
  });
});
