import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { SelectorAdaptativo } from '@/src/components/SelectorAdaptativo';
import { useSettingsStore } from '@/src/store/settingsStore';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/src/components/menu/usePosicionMenu', () => require('@/src/test-utils/menuPosicionado').menuPosicionado);

const OPCIONES = [
  { valor: 'a', label: 'Alfa' },
  { valor: 'u1', label: 'Ana', avatar: { userId: 'u1', name: 'Ana' } },
];

function montar() {
  const onClose = jest.fn();
  const onElegir = jest.fn();
  const r = render(
    <SelectorAdaptativo
      visible onClose={onClose} ancla={{ current: null }} opciones={OPCIONES}
      seleccionado="a" onElegir={onElegir} titulo="Título de hoja"
      accessibilityLabel="Selector" testID="sel"
    />,
  );
  return { ...r, onClose, onElegir };
}

describe('SelectorAdaptativo', () => {
  it('Aero: abre el menú anclado y no la hoja con título', () => {
    useSettingsStore.setState({ skin: 'aero' });
    const { getByTestId, queryByText } = montar();
    expect(getByTestId('sel').props.accessibilityRole).toBe('menu');
    expect(queryByText('Título de hoja')).toBeNull();
  });

  it('Clásico: abre la hoja con su título y una fila por opción', () => {
    useSettingsStore.setState({ skin: 'default' });
    const { getByText, queryByTestId } = montar();
    expect(getByText('Título de hoja')).toBeTruthy();
    expect(getByText('Alfa')).toBeTruthy();
    expect(getByText('Ana')).toBeTruthy();
    expect(queryByTestId('sel')).toBeNull();
  });

  it.each(['aero', 'default'] as const)('%s: elegir llama onElegir(valor) y onClose', (skin) => {
    useSettingsStore.setState({ skin });
    const { getByText, onElegir, onClose } = montar();
    fireEvent.press(getByText('Alfa'));
    expect(onElegir).toHaveBeenCalledWith('a');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Clásico: la opción con avatar también se elige', () => {
    useSettingsStore.setState({ skin: 'default' });
    const { getByText, onElegir } = montar();
    fireEvent.press(getByText('Ana'));
    expect(onElegir).toHaveBeenCalledWith('u1');
  });
});
