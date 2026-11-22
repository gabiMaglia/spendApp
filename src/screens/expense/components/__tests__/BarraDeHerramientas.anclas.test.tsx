import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { BarraDeHerramientas } from '@/src/screens/expense/components/BarraDeHerramientas';

jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-document-picker', () => ({}));

describe('BarraDeHerramientas: anclas de los selectores (T-282 t2)', () => {
  function barra() {
    const anclaFecha = React.createRef<any>();
    const anclaRepetir = React.createRef<any>();
    const onOpenDate = jest.fn();
    const onOpenRecurrence = jest.fn();
    const ui = render(
      <BarraDeHerramientas
        date={new Date()} onOpenDate={onOpenDate} recurrence={null} onOpenRecurrence={onOpenRecurrence}
        showRecurrence receiptUri={undefined} onReceiptChange={jest.fn()} note="" onOpenNote={jest.fn()}
        anclaFecha={anclaFecha} anclaRepetir={anclaRepetir}
      />,
    );
    return { ui, anclaFecha, anclaRepetir, onOpenDate, onOpenRecurrence };
  }

  it('cada chip engancha su ref a un host medible', () => {
    const { anclaFecha, anclaRepetir } = barra();
    expect(typeof anclaFecha.current?.measureInWindow).toBe('function');
    expect(typeof anclaRepetir.current?.measureInWindow).toBe('function');
    expect(anclaFecha.current).not.toBe(anclaRepetir.current);
  });

  it('los chips siguen abriendo su selector', () => {
    const { ui, onOpenDate, onOpenRecurrence } = barra();
    fireEvent.press(ui.getByTestId('barra-fecha'));
    fireEvent.press(ui.getByTestId('barra-repetir'));
    expect(onOpenDate).toHaveBeenCalledTimes(1);
    expect(onOpenRecurrence).toHaveBeenCalledTimes(1);
  });
});
