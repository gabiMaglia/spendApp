import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { HojasSplitwise } from '@/src/screens/expense/components/HojasSplitwise';

/**
 * PO 2026-11-03: las hojas donde se edita algo (cómo se divide, varios
 * pagadores) tenían que cerrarse sin confirmar, y no daba la impresión de que
 * se guardara. Ahora tienen «Listo».
 */
const reparto = {
  splitMode: 'percentage', percentSub: 'same', samePercent: '50', customPercents: [], splits: [],
  lastPercent: 50, percentError: false,
  setSamePercent: jest.fn(), setCustomPercents: jest.fn(), cambiarModo: jest.fn(), cambiarSubModo: jest.fn(),
  reiniciarParaMiembros: jest.fn(),
} as never;

function hojas(abierta: 'reparto' | 'pagadores', multiPayer: boolean, onClose = jest.fn()) {
  const ui = render(
    <HojasSplitwise
      abierta={abierta} onClose={onClose}
      members={['a', 'b']} payerId="a" onPayerChange={jest.fn()}
      multiPayer={multiPayer} payers={[]} amount={1000} currency="ARS"
      onPayersChange={jest.fn()} onTogglePayerMode={jest.fn()}
      reparto={reparto} recurrence={null} onRecurrenceChange={jest.fn()}
    />,
  );
  return { ui, onClose };
}

describe('hojas del alta con «Listo»', () => {
  it('«Cómo se divide» tiene Listo y cierra la hoja', () => {
    const { ui, onClose } = hojas('reparto', false);
    fireEvent.press(ui.getByText('common.done'));
    expect(onClose).toHaveBeenCalled();
  });

  it('«Quién pagó» con varios pagadores tiene Listo', () => {
    const { ui, onClose } = hojas('pagadores', true);
    fireEvent.press(ui.getByText('common.done'));
    expect(onClose).toHaveBeenCalled();
  });

  it('«Quién pagó» con uno solo no lo necesita: elegir ya cierra', () => {
    const { ui } = hojas('pagadores', false);
    expect(ui.queryByText('common.done')).toBeNull();
  });

  it('la leyenda del mismo % puede ocupar varias líneas (no se corta)', () => {
    const { ui } = hojas('reparto', false);
    const leyenda = ui.getByText('expense.percent_same_hint');
    expect(leyenda.props.numberOfLines).toBeUndefined();
    expect([].concat(leyenda.props.style).some((s: any) => s && (s.flex === 1 || s.flexShrink === 1))).toBe(true);
  });
});
