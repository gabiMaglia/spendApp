import React from 'react';
import { Modal } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { MenuAnclado } from '@/src/components/menu/MenuAnclado';
import type { OpcionMenu } from '@/src/components/menu/tipos';

// Mock local (no global): withTiming corre su callback sincrónico, así la salida es testeable.
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

export const anclaFalsa = (r: { x: number; y: number; width: number; height: number }) =>
  ({ current: { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(r.x, r.y, r.width, r.height) } }) as any;

const ANCLA = anclaFalsa({ x: 20, y: 100, width: 300, height: 48 });
const OPCIONES: OpcionMenu<string>[] = [
  { valor: 'a', label: 'Alfa' },
  { valor: 'b', label: 'Beta' },
  { valor: 'c', label: 'Gamma', destructive: true },
];

function montar(extra: Partial<React.ComponentProps<typeof MenuAnclado<string>>> = {}) {
  const onClose = jest.fn();
  const onElegir = jest.fn();
  const r = render(
    <MenuAnclado
      visible onClose={onClose} ancla={ANCLA} opciones={OPCIONES} seleccionado="b"
      onElegir={onElegir} accessibilityLabel="Menú de prueba" testID="m" {...extra}
    />,
  );
  return { ...r, onClose, onElegir };
}

describe('MenuAnclado — contenido, selección y cierre', () => {
  it('con visible=false no monta nada (ni el Modal)', () => {
    const { UNSAFE_queryByType, queryByText } = montar({ visible: false });
    expect(UNSAFE_queryByType(Modal)).toBeNull();
    expect(queryByText('Alfa')).toBeNull();
  });

  it('renderiza una fila por opción', () => {
    const { getByText } = montar();
    ['Alfa', 'Beta', 'Gamma'].forEach(l => expect(getByText(l)).toBeTruthy());
  });

  it('sólo la opción seleccionada tiene selected=true', () => {
    const { getAllByRole } = montar();
    const items = getAllByRole('menuitem');
    expect(items.map(i => !!i.props.accessibilityState?.selected)).toEqual([false, true, false]);
  });

  it('el contenedor expone rol menu y la etiqueta', () => {
    const { getByTestId } = montar();
    const menu = getByTestId('m');
    expect(menu.props.accessibilityRole).toBe('menu');
    expect(menu.props.accessibilityLabel).toBe('Menú de prueba');
  });

  it('elegir llama onElegir(valor) una vez y onClose', () => {
    const { getByText, onElegir, onClose } = montar();
    fireEvent.press(getByText('Alfa'));
    expect(onElegir).toHaveBeenCalledTimes(1);
    expect(onElegir).toHaveBeenCalledWith('a');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tocar el velo cierra sin elegir', () => {
    const { getByTestId, onElegir, onClose } = montar();
    fireEvent.press(getByTestId('m-velo'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onElegir).not.toHaveBeenCalled();
  });

  it('el back de Android (onRequestClose) cierra', () => {
    const { UNSAFE_getByType, onClose } = montar();
    UNSAFE_getByType(Modal).props.onRequestClose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('el Modal cubre las barras del sistema (edge-to-edge)', () => {
    const { UNSAFE_getByType } = montar();
    const props = UNSAFE_getByType(Modal).props;
    expect(props.statusBarTranslucent).toBe(true);
    expect(props.navigationBarTranslucent).toBe(true);
  });

  it('una opción con avatar muestra a la persona y se elige igual', () => {
    const { getByText, onElegir } = montar({
      opciones: [{ valor: 'u1', label: 'Ana', avatar: { userId: 'u1', name: 'Ana' } }], seleccionado: undefined,
    });
    fireEvent.press(getByText('Ana'));
    expect(onElegir).toHaveBeenCalledWith('u1');
  });
});
