import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ActionButton } from '@/src/components/ActionButton';
import { ExpenseCard } from '@/src/components/ExpenseCard';
import { Fab } from '@/src/components/Fab';
import { GroupCard } from '@/src/components/GroupCard';
import { ESCALA_PRESION } from '@/src/constants/movimiento';
import { useSettingsStore } from '@/src/store/settingsStore';

const mockSpring = jest.fn((v: number) => v);
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const base = require('react-native-reanimated/mock');
  return { ...base, withSpring: (...a: [number]) => mockSpring(...a) };
});
jest.mock('@/src/utils/haptics', () => ({ hapticAbrir: jest.fn() }));

/**
 * T-289: lo tocable de la app comparte UN feedback de presión (escala y vuelve con el
 * resorte de la marca); con reducir movimiento no se mueve nada.
 */
describe('feedback de presión común', () => {
  beforeEach(() => { mockSpring.mockClear(); useSettingsStore.setState({ reduceAnimations: false }); });

  const casos: [string, () => React.ReactElement, string][] = [
    ['ActionButton', () => <ActionButton action={() => {}} label="Saldar" testID="t" />, 't'],
    ['Fab', () => <Fab onPress={() => {}} icon="add" backgroundColor="#000" testID="t" />, 't'],
    ['GroupCard', () => <GroupCard name="Casa" memberIds={['a']} balance={0} onPress={() => {}} testID="t" />, 't'],
    ['ExpenseCard', () => <ExpenseCard title="Cena" payerName="Ana" date="2026-01-01" amount={100} onPress={() => {}} testID="t" />, 't'],
  ];

  it.each(casos)('%s escala al presionar y vuelve al soltar', (_n, vista, testID) => {
    render(vista());
    const nodo = screen.getByTestId(testID);
    fireEvent(nodo, 'pressIn');
    expect(mockSpring).toHaveBeenLastCalledWith(ESCALA_PRESION, expect.any(Object));
    fireEvent(nodo, 'pressOut');
    expect(mockSpring).toHaveBeenLastCalledWith(1, expect.any(Object));
  });

  it.each(casos)('%s no anima con reducir movimiento', (_n, vista, testID) => {
    useSettingsStore.setState({ reduceAnimations: true });
    render(vista());
    const nodo = screen.getByTestId(testID);
    fireEvent(nodo, 'pressIn');
    fireEvent(nodo, 'pressOut');
    expect(mockSpring).not.toHaveBeenCalled();
  });

  it('ActionButton sigue disparando su acción al tocarlo', () => {
    const action = jest.fn();
    render(<ActionButton action={action} label="Saldar" />);
    fireEvent.press(screen.getByText('Saldar'));
    expect(action).toHaveBeenCalledTimes(1);
  });
});
