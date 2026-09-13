import React from 'react';
import { ScrollView } from 'react-native';
import { render, fireEvent, within } from '@testing-library/react-native';
import { RecurrencePicker } from '../RecurrencePicker';

/**
 * T-118 (PO 2026-09-13): el selector de repetición pasa al estilo de pestañas
 * "T invertida" (`Segmented variant="tabs"`), en una sola fila deslizable en
 * X (`scroll`) — el mismo modo que ya usa `Segmented` para los filtros de
 * Actividad, no un componente nuevo. Con eso el rol de cada opción pasa de
 * `button` a `tab` (es lo que `Segmented variant="tabs"` renderiza), y por
 * eso los tests que antes buscaban `getAllByRole('button')` pasan a `'tab'`
 * — el cambio de rol ES el criterio de T-118, no un afloje. Por la misma
 * razón, "cuál pestaña está seleccionada" pasa de `toHaveTextContent` (el ícono
 * que ahora vive DENTRO del tab lo rompe) a `within(...).getByText(...)`: sigue
 * siendo "ese nodo contiene ese texto exacto", sólo que resiliente al ícono.
 */
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
    const selected = getAllByRole('tab').filter(b => b.props.accessibilityState?.selected);

    expect(selected).toHaveLength(1);
    expect(within(selected[0]!).getByText('recurrence.weekly')).toBeTruthy();
  });

  it('sin repetición, "una vez" es la seleccionada', () => {
    const { getAllByRole } = render(<RecurrencePicker value={null} onChange={() => {}} />);
    const selected = getAllByRole('tab').filter(b => b.props.accessibilityState?.selected);

    expect(selected).toHaveLength(1);
    expect(within(selected[0]!).getByText('recurrence.once')).toBeTruthy();
  });

  it('la aclaración sólo aparece cuando el gasto se repite', () => {
    const once = render(<RecurrencePicker value={null} onChange={() => {}} />);
    expect(once.queryByText('recurrence.hint')).toBeNull();

    const monthly = render(<RecurrencePicker value="monthly" onChange={() => {}} />);
    expect(monthly.getByText('recurrence.hint')).toBeTruthy();
  });

  it('T-118: es una sola fila que desliza en X, no chips que envuelven', () => {
    const r = render(<RecurrencePicker value={null} onChange={() => {}} />);
    // `Segmented` con `scroll` mete las opciones dentro de un ScrollView
    // horizontal — es la marca de que dejó de ser el wrap de chips viejo.
    const scrolls = r.UNSAFE_getAllByType(ScrollView).filter(s => s.props.horizontal);
    expect(scrolls.length).toBeGreaterThan(0);
    expect(r.getByTestId('segmented-tabs-wrap')).toBeTruthy();
  });
});
