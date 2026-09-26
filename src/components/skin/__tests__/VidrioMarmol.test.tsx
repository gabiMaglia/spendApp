import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { VidrioMarmol } from '@/src/components/skin/VidrioMarmol';
import { useSettingsStore } from '@/src/store/settingsStore';

describe('VidrioMarmol', () => {
  it('con el skin default no dibuja nada', () => {
    useSettingsStore.setState({ skin: 'default', reduceAnimations: false });
    render(<VidrioMarmol />);
    expect(screen.queryByTestId('vidrio-marmol', { includeHiddenElements: true })).toBeNull();
  });

  it('con aero dibuja la capa de vidrio', () => {
    useSettingsStore.setState({ skin: 'aero', reduceAnimations: false });
    render(<VidrioMarmol />);
    expect(screen.getByTestId('vidrio-marmol', { includeHiddenElements: true })).toBeTruthy();
  });

  it('con aero degradado también (velo plano)', () => {
    useSettingsStore.setState({ skin: 'aero', reduceAnimations: true });
    render(<VidrioMarmol />);
    expect(screen.getByTestId('vidrio-marmol', { includeHiddenElements: true })).toBeTruthy();
  });
});
