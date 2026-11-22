import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { Fab } from '@/src/components/Fab';
import { vibrar } from '@/src/utils/haptics';

jest.mock('@/src/utils/haptics', () => ({ vibrar: jest.fn() }));

describe('Fab — vibración por intención (T-289)', () => {
  beforeEach(() => (vibrar as jest.Mock).mockClear());

  it('por defecto vibra «abrir»', () => {
    render(<Fab onPress={() => {}} icon="add" backgroundColor="#000" testID="f" />);
    fireEvent.press(screen.getByTestId('f'));
    expect(vibrar).toHaveBeenCalledWith('abrir');
  });

  it('con haptica="confirmar" vibra «confirmar» y dispara la acción', () => {
    const onPress = jest.fn();
    render(<Fab onPress={onPress} icon="share-outline" backgroundColor="#000" testID="f" haptica="confirmar" />);
    fireEvent.press(screen.getByTestId('f'));
    expect(vibrar).toHaveBeenCalledWith('confirmar');
    expect(vibrar).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
