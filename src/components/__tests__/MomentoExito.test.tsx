import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { MomentoExito, type Momento } from '@/src/components/MomentoExito';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// MontoRodante tiene sus propios tests; acá sólo importa QUÉ monto recibe.
jest.mock('@/src/components/MontoRodante', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: T } = require('react-native');
  return { MontoRodante: (p: { minor: number; code?: string }) => <T>{`monto:${p.code}:${p.minor}`}</T> };
});

let mockReducidas: boolean | null = false;
jest.mock('@/src/hooks/useAnimacionesReducidas', () => ({
  useAnimacionesReducidas: () => mockReducidas,
}));

const momento: Momento = {
  clave: 1,
  montos: [{ minor: 12550, code: 'ARS' }],
  titulo: 'settle.done_title',
  detalle: 'settle.done_to',
};

describe('MomentoExito (T-290)', () => {
  let anuncio: jest.SpyInstance;
  let lector: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers(); mockReducidas = false;
    anuncio = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    anuncio.mockClear();
    lector = jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  it('sin momento no dibuja nada', () => {
    const { queryByTestId } = render(<MomentoExito momento={null} onTerminar={jest.fn()} />);
    expect(queryByTestId('momento-exito')).toBeNull();
  });

  it('muestra el monto final, el título y el detalle, y navega a los ~900 ms', async () => {
    const onTerminar = jest.fn();
    const { getByText, getByTestId } = render(<MomentoExito momento={momento} onTerminar={onTerminar} />);
    expect(getByTestId('momento-exito')).toBeTruthy();
    expect(getByText('monto:ARS:12550')).toBeTruthy();
    expect(getByText('settle.done_title')).toBeTruthy();
    expect(getByText('settle.done_to')).toBeTruthy();

    await act(async () => {});
    act(() => { jest.advanceTimersByTime(850); });
    expect(onTerminar).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(100); });
    expect(onTerminar).toHaveBeenCalledTimes(1);
  });

  it('muestra un monto por moneda cuando hay varias', () => {
    const { getByText } = render(
      <MomentoExito
        momento={{ ...momento, montos: [{ minor: 100, code: 'ARS' }, { minor: 5, code: 'USD' }] }}
        onTerminar={jest.fn()}
      />,
    );
    expect(getByText('monto:ARS:100')).toBeTruthy();
    expect(getByText('monto:USD:5')).toBeTruthy();
  });

  it('tocar lo saltea: navega ya y una sola vez', () => {
    const onTerminar = jest.fn();
    const { getByTestId } = render(<MomentoExito momento={momento} onTerminar={onTerminar} />);
    fireEvent.press(getByTestId('momento-exito'));
    expect(onTerminar).toHaveBeenCalledTimes(1);
    act(() => { jest.advanceTimersByTime(2000); });
    expect(onTerminar).toHaveBeenCalledTimes(1);
  });

  it('con reducir movimiento muestra el estado final y navega a los ~600 ms', async () => {
    mockReducidas = true;
    const onTerminar = jest.fn();
    const { getByText } = render(<MomentoExito momento={momento} onTerminar={onTerminar} />);
    expect(getByText('monto:ARS:12550')).toBeTruthy();
    await act(async () => {});
    act(() => { jest.advanceTimersByTime(550); });
    expect(onTerminar).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(100); });
    expect(onTerminar).toHaveBeenCalledTimes(1);
  });

  it('mientras no se sabe si hay que reducir, no arranca el reloj', () => {
    mockReducidas = null;
    const onTerminar = jest.fn();
    render(<MomentoExito momento={momento} onTerminar={onTerminar} />);
    act(() => { jest.advanceTimersByTime(3000); });
    expect(onTerminar).not.toHaveBeenCalled();
  });

  it('un detalle vacío no dibuja la línea', () => {
    const { queryByText } = render(
      <MomentoExito momento={{ ...momento, detalle: '' }} onTerminar={jest.fn()} />,
    );
    expect(queryByText('settle.done_to')).toBeNull();
  });

  describe('accesibilidad (T-291)', () => {
    it('anuncia título y detalle una sola vez al mostrarse', async () => {
      const { rerender } = render(<MomentoExito momento={momento} onTerminar={jest.fn()} />);
      await act(async () => {});
      expect(anuncio).toHaveBeenCalledTimes(1);
      expect(anuncio).toHaveBeenCalledWith('settle.done_title. settle.done_to');
      rerender(<MomentoExito momento={momento} onTerminar={jest.fn()} />);
      expect(anuncio).toHaveBeenCalledTimes(1);
    });

    it('con lector de pantalla activo no se cierra solo; tocar sí cierra', async () => {
      lector.mockResolvedValue(true);
      const onTerminar = jest.fn();
      const { getByTestId } = render(<MomentoExito momento={momento} onTerminar={onTerminar} />);
      await act(async () => {});
      act(() => { jest.advanceTimersByTime(5000); });
      expect(onTerminar).not.toHaveBeenCalled();
      fireEvent.press(getByTestId('momento-exito'));
      expect(onTerminar).toHaveBeenCalledTimes(1);
    });

    it('con lector activo y reducir movimiento tampoco se cierra solo', async () => {
      lector.mockResolvedValue(true);
      mockReducidas = true;
      const onTerminar = jest.fn();
      render(<MomentoExito momento={momento} onTerminar={onTerminar} />);
      await act(async () => {});
      act(() => { jest.advanceTimersByTime(5000); });
      expect(onTerminar).not.toHaveBeenCalled();
    });

    it('sin lector, tras resolver la consulta, se cierra a los ~900 ms', async () => {
      const onTerminar = jest.fn();
      render(<MomentoExito momento={momento} onTerminar={onTerminar} />);
      await act(async () => {});
      act(() => { jest.advanceTimersByTime(950); });
      expect(onTerminar).toHaveBeenCalledTimes(1);
    });
  });
});
