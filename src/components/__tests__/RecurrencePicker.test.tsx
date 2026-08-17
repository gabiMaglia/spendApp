import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { RecurrencePicker } from '../RecurrencePicker';

describe('RecurrencePicker', () => {
  it('ofrece "una vez" además de las 4 frecuencias', () => {
    const { getByText } = render(<RecurrencePicker value={null} onChange={() => {}} />);
    ['recurrence.once', 'recurrence.weekly', 'recurrence.fortnightly',
     'recurrence.monthly', 'recurrence.yearly'].forEach(k => {
      expect(getByText(k)).toBeTruthy();
    });
  });

  it('avisa al elegir una frecuencia', () => {
    const onChange = jest.fn();
    const { getByText } = render(<RecurrencePicker value={null} onChange={onChange} />);

    fireEvent.press(getByText('recurrence.monthly'));

    expect(onChange).toHaveBeenCalledWith('monthly');
  });

  it('permite volver a "una vez"', () => {
    const onChange = jest.fn();
    const { getByText } = render(<RecurrencePicker value="monthly" onChange={onChange} />);

    fireEvent.press(getByText('recurrence.once'));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('marca como seleccionada la opción activa y sólo esa', () => {
    const { getAllByRole } = render(<RecurrencePicker value="weekly" onChange={() => {}} />);
    const selected = getAllByRole('button').filter(b => b.props.accessibilityState?.selected);

    expect(selected).toHaveLength(1);
    expect(selected[0]!).toHaveTextContent('recurrence.weekly');
  });

  it('sin repetición, "una vez" es la seleccionada', () => {
    const { getAllByRole } = render(<RecurrencePicker value={null} onChange={() => {}} />);
    const selected = getAllByRole('button').filter(b => b.props.accessibilityState?.selected);

    expect(selected).toHaveLength(1);
    expect(selected[0]!).toHaveTextContent('recurrence.once');
  });

  it('la aclaración sólo aparece cuando el gasto se repite', () => {
    const once = render(<RecurrencePicker value={null} onChange={() => {}} />);
    expect(once.queryByText('recurrence.hint')).toBeNull();

    const monthly = render(<RecurrencePicker value="monthly" onChange={() => {}} />);
    expect(monthly.getByText('recurrence.hint')).toBeTruthy();
  });
});
