import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SkinPicker } from '@/src/components/SkinPicker';
import { useSettingsStore } from '@/src/store/settingsStore';

describe('SkinPicker', () => {
  beforeEach(() => useSettingsStore.setState({ skin: 'default' }));

  it('muestra las dos opciones y la nota de vista previa', () => {
    render(<SkinPicker />);
    expect(screen.getByText('profile.skin_classic')).toBeTruthy();
    expect(screen.getByText('profile.skin_aero')).toBeTruthy();
    expect(screen.getByText('profile.skin_preview_note')).toBeTruthy();
  });

  it('tocar Aero cambia el skin', () => {
    render(<SkinPicker />);
    fireEvent.press(screen.getByText('profile.skin_aero'));
    expect(useSettingsStore.getState().skin).toBe('aero');
  });

  it('tocar Clásico vuelve al default', () => {
    useSettingsStore.setState({ skin: 'aero' });
    render(<SkinPicker />);
    fireEvent.press(screen.getByText('profile.skin_classic'));
    expect(useSettingsStore.getState().skin).toBe('default');
  });
});
