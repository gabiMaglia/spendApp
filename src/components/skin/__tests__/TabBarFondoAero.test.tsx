import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { TabBarFondoAero } from '@/src/components/skin/TabBarFondoAero';
import { useSettingsStore } from '@/src/store/settingsStore';

describe('TabBarFondoAero', () => {
  it('dibuja la tarjeta con mármol y vidrio', () => {
    useSettingsStore.setState({ skin: 'aero', reduceAnimations: false });
    render(<TabBarFondoAero inferior={24} />);
    expect(screen.getByTestId('tabbar-aero', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('fondo-marmol', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('vidrio-marmol', { includeHiddenElements: true })).toBeTruthy();
  });
});
