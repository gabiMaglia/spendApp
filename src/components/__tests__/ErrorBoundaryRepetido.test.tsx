import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

import { ErrorBoundary } from '../ErrorBoundary';
import { listErrors } from '@/src/services/errorLog';
import { createSecureStorage } from '@/src/utils/secureStorage';

/**
 * T-264: un error de render que se repite no puede dejar al usuario en un
 * bucle de «reintentar → se rompe → reintentar», ni llenar el registro.
 */
const TEXTOS = {
  title: 'error.boundary_title',
  body: 'error.boundary_body',
  retry: 'error.retry',
  exportar: 'error.export_diagnostics',
};

let debeTirar = true;
function Explota(): React.ReactElement {
  if (debeTirar) throw new Error('se rompió el render');
  return <Text>contenido sano</Text>;
}

let consola: jest.SpyInstance;
beforeEach(() => {
  createSecureStorage('notices').clearAll();
  debeTirar = true;
  consola = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consola.mockRestore();
  jest.useRealTimers();
});

describe('un error que se repite', () => {
  it('tras 3 reintentos que vuelven a romper, deja de ofrecer reintentar y queda estable', () => {
    const { getByText, queryByText } = render(
      <ErrorBoundary textos={TEXTOS} onExport={() => {}}><Explota /></ErrorBoundary>,
    );

    for (let i = 0; i < 3; i++) fireEvent.press(getByText('error.retry'));

    expect(queryByText('error.retry')).toBeNull();
    expect(getByText('error.boundary_title')).toBeTruthy();
    expect(getByText('error.export_diagnostics')).toBeTruthy();
  });

  it('no llena el registro con el mismo error repetido', () => {
    const { getByText } = render(
      <ErrorBoundary textos={TEXTOS}><Explota /></ErrorBoundary>,
    );
    for (let i = 0; i < 2; i++) fireEvent.press(getByText('error.retry'));

    expect(listErrors()).toHaveLength(1);
  });

  it('si lo reintentado se sostiene sano un rato, el contador vuelve a cero', () => {
    jest.useFakeTimers();
    const { getByText, queryByText } = render(
      <ErrorBoundary textos={TEXTOS}><Explota /></ErrorBoundary>,
    );
    fireEvent.press(getByText('error.retry'));
    fireEvent.press(getByText('error.retry'));

    debeTirar = false;
    fireEvent.press(getByText('error.retry'));
    expect(getByText('contenido sano')).toBeTruthy();
    act(() => { jest.advanceTimersByTime(6000); });

    // una pantalla sana por un rato borra el historial de fallos
    expect(queryByText('error.retry')).toBeNull();
    expect(getByText('contenido sano')).toBeTruthy();
  });
});
