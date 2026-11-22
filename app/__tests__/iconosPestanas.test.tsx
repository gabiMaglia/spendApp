import React from 'react';
import { render } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';

/** T-294: la barra usa glifos propios; la activa en dos tonos, las demás sólo trazo. */
const pantallas: Record<string, any> = {};

jest.mock('expo-router', () => {
  const R = jest.requireActual('react');
  function Tabs({ children }: any) { return R.createElement(R.Fragment, null, children); }
  Tabs.Screen = function TabsScreen({ name, options }: any) { pantallas[name] = options; return null; };
  return { Tabs };
});

const iconoDe = (name: string, focused: boolean) =>
  render(<>{pantallas[name].tabBarIcon({ focused, color: '#123456', size: 24 })}</>);

describe('T-294 — iconos de la barra de pestañas', () => {
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TabLayout = require('@/app/(tabs)/_layout').default;
    render(<TabLayout />);
  });

  it.each([
    ['index', 'personal'], ['groups', 'grupos'], ['friends', 'amigos'], ['activity', 'actividad'],
  ])('la pestaña %s dibuja el glifo propio %s', (name, glifo) => {
    expect(iconoDe(name, false).getByTestId(`icono-glifo-${glifo}-trazo`)).toBeTruthy();
  });

  it('la pestaña activa va en dos tonos y la inactiva sólo en trazo', () => {
    const activa = iconoDe('groups', true);
    expect(activa.getByTestId('icono-glifo-grupos-tonos')).toBeTruthy();
    expect(activa.queryByTestId('icono-glifo-grupos-trazo')).toBeNull();
    const inactiva = iconoDe('groups', false);
    expect(inactiva.queryByTestId('icono-glifo-grupos-tonos')).toBeNull();
  });

  it('el layout ya no importa Ionicons', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '(tabs)', '_layout.tsx'), 'utf8');
    expect(src).not.toMatch(/Ionicons/);
  });
});
