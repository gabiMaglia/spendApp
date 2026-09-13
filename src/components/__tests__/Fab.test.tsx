import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Fab, separacionInferiorDelFab } from '../Fab';

describe('Fab', () => {
  it('renders the label', () => {
    render(<Fab onPress={() => {}} icon="add" label="Gasto" backgroundColor="#000" />);
    expect(screen.getByText('Gasto')).toBeTruthy();
  });

  it('calls onPress when tapped without a label (icon-only)', () => {
    const onPress = jest.fn();
    render(<Fab onPress={onPress} icon="add" backgroundColor="#000" testID="fab" />);
    fireEvent.press(screen.getByTestId('fab'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    render(<Fab onPress={onPress} icon="add" label="Gasto" backgroundColor="#000" />);
    fireEvent.press(screen.getByText('Gasto'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

/**
 * Dónde queda el FAB respecto de la barra del sistema (PO, 2026-09-12).
 *
 * En «Agregar contacto» el botón de compartir quedó DEBAJO de la barra de tres botones de
 * Android. Un hijo absoluto se posiciona contra el borde del contenedor, no contra su
 * padding: el `SafeAreaView` no lo corre. Dentro de las pestañas no pasaba porque la tab bar
 * ya ocupa esa franja.
 */
describe('separacionInferiorDelFab', () => {
  it('dentro de las pestañas no suma el inset: la tab bar ya lo ocupa', () => {
    expect(separacionInferiorDelFab({ dentroDePestanas: true, insetInferior: 48 })).toBe(16);
  });

  it('fuera de las pestañas suma el inset del sistema, para no quedar debajo de la barra', () => {
    expect(separacionInferiorDelFab({ dentroDePestanas: false, insetInferior: 48 })).toBe(64);
  });

  it('sin barra del sistema (inset 0) queda igual en los dos casos', () => {
    expect(separacionInferiorDelFab({ dentroDePestanas: false, insetInferior: 0 })).toBe(16);
  });
});
