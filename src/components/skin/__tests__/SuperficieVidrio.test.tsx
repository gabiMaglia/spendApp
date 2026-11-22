import React from 'react';
import { Platform, Text } from 'react-native';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { render, screen } from '@testing-library/react-native';

import { SuperficieVidrio } from '@/src/components/skin/SuperficieVidrio';
import { useSettingsStore } from '@/src/store/settingsStore';

jest.mock('expo-blur', () => {
  const R = require('react');
  const { View } = require('react-native');
  return { BlurView: (p: any) => R.createElement(View, { ...p, testID: 'blur-view' }) };
});

const original = Platform.OS;
const enPlataforma = (os: 'ios' | 'android') => { Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true }); };
afterEach(() => { Object.defineProperty(Platform, 'OS', { get: () => original, configurable: true }); });

describe('SuperficieVidrio', () => {
  beforeEach(() => useSettingsStore.setState({ skin: 'aero', reduceAnimations: false }));

  it('iOS: monta exactamente un BlurView y deja pasar los hijos', () => {
    enPlataforma('ios');
    render(<SuperficieVidrio radio={20}><Text>hola</Text></SuperficieVidrio>);
    expect(screen.getAllByTestId('blur-view', { includeHiddenElements: true })).toHaveLength(1);
    expect(screen.getByText('hola')).toBeTruthy();
  });

  it('Android: no monta BlurView, usa la superficie translúcida', () => {
    enPlataforma('android');
    render(<SuperficieVidrio radio={20} />);
    expect(screen.queryByTestId('blur-view', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('superficie-vidrio-translucida', { includeHiddenElements: true })).toBeTruthy();
  });

  it('iOS con «reducir animaciones»: sin blur (costo cero)', () => {
    enPlataforma('ios');
    useSettingsStore.setState({ reduceAnimations: true });
    render(<SuperficieVidrio radio={20} />);
    expect(screen.queryByTestId('blur-view', { includeHiddenElements: true })).toBeNull();
  });
});

describe('un solo dueño del blur (T-292)', () => {
  it('ningún archivo de la app importa expo-blur salvo SuperficieVidrio', () => {
    const raiz = join(__dirname, '../../../..');
    const hallados: string[] = [];
    const recorrer = (dir: string) => {
      for (const n of readdirSync(dir)) {
        if (['node_modules', '__tests__', '.git', 'engram'].includes(n)) continue;
        const ruta = join(dir, n);
        if (statSync(ruta).isDirectory()) recorrer(ruta);
        else if (/\.tsx?$/.test(n) && readFileSync(ruta, 'utf8').includes("from 'expo-blur'")) hallados.push(n);
      }
    };
    ['app', 'src', 'components'].forEach(d => recorrer(join(raiz, d)));
    expect(hallados).toEqual(['SuperficieVidrio.tsx']);
  });
});
