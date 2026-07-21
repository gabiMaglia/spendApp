import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Fab } from '../Fab';

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
