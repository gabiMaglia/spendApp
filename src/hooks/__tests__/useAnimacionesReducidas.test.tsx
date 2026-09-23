import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';
import { useAnimacionesReducidas } from '@/src/hooks/useAnimacionesReducidas';
import { useSettingsStore } from '@/src/store/settingsStore';

function Sonda() {
  const reducidas = useAnimacionesReducidas();
  return <Text testID="valor">{String(reducidas)}</Text>;
}

describe('useAnimacionesReducidas', () => {
  beforeEach(() => {
    useSettingsStore.setState({ reduceAnimations: false });
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  });

  afterEach(() => jest.restoreAllMocks());

  it('arranca en null mientras resuelve la consulta de accesibilidad', () => {
    const r = render(<Sonda />);
    expect(r.getByTestId('valor').props.children).toBe('null');
  });

  it('ninguna de las dos fuentes activa: false', async () => {
    const r = render(<Sonda />);
    await waitFor(() => expect(r.getByTestId('valor').props.children).toBe('false'));
  });

  it('el toggle manual (settingsStore) alcanza para dar true, sin esperar accesibilidad', async () => {
    useSettingsStore.setState({ reduceAnimations: true });
    const r = render(<Sonda />);
    await waitFor(() => expect(r.getByTestId('valor').props.children).toBe('true'));
  });

  it('"reducir movimiento" del sistema alcanza para dar true, aunque el toggle esté apagado', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const r = render(<Sonda />);
    await waitFor(() => expect(r.getByTestId('valor').props.children).toBe('true'));
  });
});
