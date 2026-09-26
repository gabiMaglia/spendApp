import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { DetailHeader } from '@/src/components/CollapsibleHeader';
import { BottomSheet } from '@/src/components/Sheet';
import { useSettingsStore } from '@/src/store/settingsStore';

/** Etapa 2 del Aero: primitivas compartidas. Comportamiento, no estilos. */
describe.each(['default', 'aero'] as const)('con skin %s', skinId => {
  beforeEach(() => useSettingsStore.setState({ skin: skinId, reduceAnimations: true }));

  it('DetailHeader muestra el título y vuelve atrás', () => {
    const onBack = jest.fn();
    render(<DetailHeader title="Detalle" onBack={onBack} right={<Text>Guardar</Text>} />);
    expect(screen.getByText('Detalle')).toBeTruthy();
    expect(screen.getByText('Guardar')).toBeTruthy();
    expect(!!screen.queryByTestId('detail-header-aero')).toBe(skinId === 'aero');
  });

  it('BottomSheet muestra título, contenido y pie', () => {
    render(
      <BottomSheet visible onClose={() => {}} title="Hoja" footer={<Text>Listo</Text>}>
        <Text>contenido</Text>
      </BottomSheet>,
    );
    expect(screen.getByText('Hoja')).toBeTruthy();
    expect(screen.getByText('contenido')).toBeTruthy();
    expect(screen.getByText('Listo')).toBeTruthy();
  });
});

describe('DetailHeader aero', () => {
  it('el botón de volver sigue funcionando', () => {
    useSettingsStore.setState({ skin: 'aero', reduceAnimations: true });
    const onBack = jest.fn();
    const { UNSAFE_root } = render(<DetailHeader title="X" onBack={onBack} />);
    const boton = UNSAFE_root.findAll(n => typeof n.props.onPress === 'function')[0];
    fireEvent.press(boton);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
