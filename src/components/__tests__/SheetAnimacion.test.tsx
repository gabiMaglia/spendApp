import React from 'react';
import { Animated, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { BottomSheet } from '@/src/components/Sheet';
import { useSettingsStore } from '@/src/store/settingsStore';

/**
 * "Reducir animaciones" (PO 2026-09-22): el fade + deslizamiento de entrada
 * del sheet tiene que saltarse cuando el toggle (o "reducir movimiento" del
 * sistema) está prendido — mismo criterio que ya tenía `MontoRodante`.
 * Se verifica espiando `Animated.timing`: no hace falta un valor final
 * inspeccionable, sólo que la duración pedida sea 0.
 */
describe('BottomSheet — reducir animaciones', () => {
  afterEach(() => jest.restoreAllMocks());

  it('con el toggle apagado, anima con la duración normal (> 0)', () => {
    useSettingsStore.setState({ reduceAnimations: false });
    const spy = jest.spyOn(Animated, 'timing');

    render(
      <BottomSheet visible onClose={() => {}}>
        <Text>contenido</Text>
      </BottomSheet>,
    );

    const duraciones = spy.mock.calls.map(([, config]) => config.duration);
    expect(duraciones.some(d => (d ?? 0) > 0)).toBe(true);
  });

  it('con el toggle prendido, la animación de entrada tiene duración 0', () => {
    useSettingsStore.setState({ reduceAnimations: true });
    const spy = jest.spyOn(Animated, 'timing');

    render(
      <BottomSheet visible onClose={() => {}}>
        <Text>contenido</Text>
      </BottomSheet>,
    );

    const duraciones = spy.mock.calls.map(([, config]) => config.duration);
    expect(duraciones.every(d => d === 0)).toBe(true);
  });
});
