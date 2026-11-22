import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { ActionButton, type ActionButtonProps } from '@/src/components/ActionButton';
import { useSettingsStore } from '@/src/store/settingsStore';

const estilo = (p: Partial<ActionButtonProps> = {}) => {
  render(<ActionButton action={() => {}} label="Guardar" testID="b" {...p} />);
  return StyleSheet.flatten(screen.getByTestId('b').props.style) as Record<string, unknown>;
};

/** T-292: el primario del Aero tiene volumen (degradé + brillo + sombra de marca). */
describe('ActionButton primario con volumen (Aero)', () => {
  beforeEach(() => useSettingsStore.setState({ skin: 'aero', reduceAnimations: false }));

  it('el primario habilitado lleva degradé y sombra', () => {
    const e = estilo();
    expect(e.experimental_backgroundImage).toEqual(expect.stringContaining('linear-gradient'));
    expect(e.boxShadow).toEqual(expect.any(String));
  });

  it('deshabilitado o cargando: sin degradé ni sombra', () => {
    for (const p of [{ disabled: true }, { loading: true }]) {
      const e = estilo(p);
      expect(e.experimental_backgroundImage).toBeUndefined();
      expect(e.boxShadow).toBeUndefined();
    }
  });

  it('las demás variantes quedan planas', () => {
    for (const variant of ['secondary', 'ghost', 'danger', 'plain'] as const) {
      expect(estilo({ variant }).boxShadow).toBeUndefined();
    }
  });

  it('con «reducir animaciones» (degradado) vuelve al plano', () => {
    useSettingsStore.setState({ reduceAnimations: true });
    expect(estilo().experimental_backgroundImage).toBeUndefined();
  });

  it('Clásico no cambia', () => {
    useSettingsStore.setState({ skin: 'default' });
    const e = estilo();
    expect(e.experimental_backgroundImage).toBeUndefined();
    expect(e.boxShadow).toBeUndefined();
  });
});
