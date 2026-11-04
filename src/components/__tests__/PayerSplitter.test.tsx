import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { PayerSplitter } from '../PayerSplitter';
import type { Payer } from '@/src/types/models';

// El idioma activo varía por test: de él depende el separador de miles/decimal.
let mockLanguage = 'es';
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: jest.fn() },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: mockLanguage, changeLanguage: jest.fn() },
  }),
}));

const members = [{ id: 'ua', name: 'Ana' }, { id: 'ub', name: 'Bob' }];

function setup(value: Payer[], totalAmount = 10000) {
  const onChange = jest.fn();
  const utils = render(
    <PayerSplitter
      members={members}
      value={value}
      totalAmount={totalAmount}
      currency="ARS"
      onChange={onChange}
    />,
  );
  return { ...utils, onChange };
}

describe('PayerSplitter', () => {
  it('muestra un campo por miembro', () => {
    const { getAllByLabelText, getByText } = setup([]);
    expect(getAllByLabelText(/payers\.amount_for/)).toHaveLength(members.length);
    expect(getByText('Ana')).toBeTruthy();
    expect(getByText('Bob')).toBeTruthy();
  });

  it('avisa cuando la suma cuadra con el total', () => {
    const { getByText } = setup([
      { userId: 'ua', amount: 6000 }, { userId: 'ub', amount: 4000 },
    ]);
    expect(getByText('payers.balanced')).toBeTruthy();
  });

  it('avisa cuánto falta cuando no llega al total', () => {
    const { getByText } = setup([
      { userId: 'ua', amount: 6000 }, { userId: 'ub', amount: 3000 },
    ]);
    expect(getByText(/payers\.missing/)).toBeTruthy();
  });

  it('avisa cuando se pasan del total', () => {
    const { getByText } = setup([
      { userId: 'ua', amount: 9000 }, { userId: 'ub', amount: 3000 },
    ]);
    expect(getByText(/payers\.over/)).toBeTruthy();
  });

  it('convierte lo que se escribe a menor unidad', () => {
    const { getAllByLabelText, onChange } = setup([]);

    fireEvent.changeText(getAllByLabelText(/payers\.amount_for/)[0]!, '62.50');

    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([{ userId: 'ua', amount: 6250 }]),
    );
  });

  it('acepta coma como separador decimal', () => {
    const { getAllByLabelText, onChange } = setup([]);

    fireEvent.changeText(getAllByLabelText(/payers\.amount_for/)[0]!, '62,50');

    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([{ userId: 'ua', amount: 6250 }]),
    );
  });

  it('un texto inválido cuenta como 0, no como NaN', () => {
    const { getAllByLabelText, onChange } = setup([]);

    fireEvent.changeText(getAllByLabelText(/payers\.amount_for/)[0]!, 'abc');

    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([{ userId: 'ua', amount: 0 }]),
    );
  });

  it('no deja montos negativos', () => {
    const { getAllByLabelText, onChange } = setup([]);

    fireEvent.changeText(getAllByLabelText(/payers\.amount_for/)[0]!, '-50');

    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([{ userId: 'ua', amount: 0 }]),
    );
  });

  it('conserva lo cargado de los demás al editar uno', () => {
    const { getAllByLabelText, onChange } = setup([
      { userId: 'ua', amount: 1000 }, { userId: 'ub', amount: 4000 },
    ]);

    fireEvent.changeText(getAllByLabelText(/payers\.amount_for/)[0]!, '60');

    expect(onChange).toHaveBeenCalledWith([
      { userId: 'ua', amount: 6000 },
      { userId: 'ub', amount: 4000 },
    ]);
  });

  // Obs 3 de QA: mismos separadores y miles que el monto principal.
  it.each([
    ['es', '1.250,5',  125050],
    ['es', '12.50',    1250],
    ['es', '1.250',    125000],
    ['en', '1,250.5',  125050],
    ['en', '12,50',    1250],
    ['en', '1,250',    125000],
  ])('(%s) «%s» se lee como %i en menor unidad', (lang, texto, esperado) => {
    mockLanguage = lang;
    const { getAllByLabelText, onChange } = setup([]);

    fireEvent.changeText(getAllByLabelText(/payers\.amount_for/)[0]!, texto);

    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([{ userId: 'ua', amount: esperado }]),
    );
    mockLanguage = 'es';
  });

  it('muestra el monto cargado con miles y separador del idioma', () => {
    mockLanguage = 'es';
    const { getAllByLabelText } = setup([{ userId: 'ua', amount: 125050 }]);
    expect(getAllByLabelText(/payers\.amount_for/)[0]!.props.value).toBe('1.250,5');
  });

  it('un decimal recién tipeado no se pierde mientras se escribe', () => {
    mockLanguage = 'es';
    // Padre real: devuelve el valor nuevo, como hace la pantalla de gasto.
    function Padre() {
      const [value, setValue] = React.useState<Payer[]>([]);
      return (
        <PayerSplitter members={members} value={value} totalAmount={10000} currency="ARS" onChange={setValue} />
      );
    }
    const { getAllByLabelText } = render(<Padre />);
    fireEvent.changeText(getAllByLabelText(/payers\.amount_for/)[0]!, '12,');
    expect(getAllByLabelText(/payers\.amount_for/)[0]!.props.value).toBe('12,');
  });
});
