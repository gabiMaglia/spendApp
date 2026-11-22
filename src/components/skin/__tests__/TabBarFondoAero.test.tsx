import React from 'react';
import { Platform } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { TabBarFondoAero } from '@/src/components/skin/TabBarFondoAero';
import { useSettingsStore } from '@/src/store/settingsStore';

jest.mock('expo-blur', () => {
  const R = require('react');
  const { View } = require('react-native');
  return { BlurView: (p: any) => R.createElement(View, { ...p, testID: 'blur-view' }) };
});

const original = Platform.OS;
const enPlataforma = (os: 'ios' | 'android') => { Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true }); };
afterEach(() => { Object.defineProperty(Platform, 'OS', { get: () => original, configurable: true }); });

describe('TabBarFondoAero', () => {
  beforeEach(() => useSettingsStore.setState({ skin: 'aero', reduceAnimations: false }));

  it('iOS: la píldora es vidrio con un solo BlurView', () => {
    enPlataforma('ios');
    render(<TabBarFondoAero bottom={24} alto={62} margen={16} />);
    expect(screen.getByTestId('tabbar-aero', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getAllByTestId('blur-view', { includeHiddenElements: true })).toHaveLength(1);
  });

  it('Android: la píldora no monta BlurView', () => {
    enPlataforma('android');
    render(<TabBarFondoAero bottom={24} alto={62} margen={16} />);
    expect(screen.getByTestId('tabbar-aero', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('blur-view', { includeHiddenElements: true })).toBeNull();
  });
});
