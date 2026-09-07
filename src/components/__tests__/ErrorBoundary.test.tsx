import React, { useState } from 'react';
import { Text, Pressable } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

import { ErrorBoundary } from '../ErrorBoundary';
import { listErrors } from '@/src/services/errorLog';
import { createSecureStorage } from '@/src/utils/secureStorage';

/**
 * T-078 · El límite de error.
 *
 * Lo que cierra: hasta hoy un error de render en cualquier pantalla se llevaba
 * la app entera —pantalla blanca en producción, sin camino de vuelta salvo
 * cerrar y reabrir— y no dejaba rastro.
 *
 * Se testea COMPORTAMIENTO: qué se renderiza, qué se anota, y que reintentar
 * vuelva. Nada de tamaños ni colores.
 */
const TEXTOS = {
  title: 'error.boundary_title',
  body: 'error.boundary_body',
  retry: 'error.retry',
  exportar: 'error.export_diagnostics',
};

/** Un hijo que tira en el render, con interruptor para dejar de tirar. */
let debeTirar = true;
function Explota(): React.ReactElement {
  if (debeTirar) throw new Error('se rompió el render');
  return <Text>contenido sano</Text>;
}

/** React escribe el error en consola aunque el límite lo capture. */
let consola: jest.SpyInstance;

beforeEach(() => {
  createSecureStorage('notices').clearAll();
  debeTirar = true;
  consola = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => consola.mockRestore());

describe('cuando un hijo se rompe', () => {
  it('muestra la pantalla de recuperación en vez de una pantalla en blanco', () => {
    const { getByText } = render(
      <ErrorBoundary textos={TEXTOS}><Explota /></ErrorBoundary>,
    );

    expect(getByText('error.boundary_title')).toBeTruthy();
    expect(getByText('error.retry')).toBeTruthy();
  });

  it('anota el error como fatal, UNA sola vez', () => {
    render(<ErrorBoundary textos={TEXTOS}><Explota /></ErrorBoundary>);

    const anotados = listErrors();
    expect(anotados).toHaveLength(1);
    expect(anotados[0]).toMatchObject({ fatal: true, message: 'se rompió el render' });
  });

  it('ofrece exportar sólo si el que lo usa le pasó cómo', () => {
    const { queryByText, rerender } = render(
      <ErrorBoundary textos={TEXTOS}><Explota /></ErrorBoundary>,
    );
    expect(queryByText('error.export_diagnostics')).toBeNull();

    const onExport = jest.fn();
    rerender(
      <ErrorBoundary textos={TEXTOS} onExport={onExport}><Explota /></ErrorBoundary>,
    );
    fireEvent.press(queryByText('error.export_diagnostics')!);
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('«reintentar» vuelve a montar el hijo', () => {
    const { getByText, queryByText } = render(
      <ErrorBoundary textos={TEXTOS}><Explota /></ErrorBoundary>,
    );

    debeTirar = false;                       // el usuario arregló lo que fuera
    fireEvent.press(getByText('error.retry'));

    expect(getByText('contenido sano')).toBeTruthy();
    expect(queryByText('error.boundary_title')).toBeNull();
  });
});

describe('cuando nada se rompe', () => {
  it('renderiza al hijo y no anota nada', () => {
    debeTirar = false;

    const { getByText, queryByText } = render(
      <ErrorBoundary textos={TEXTOS}><Explota /></ErrorBoundary>,
    );

    expect(getByText('contenido sano')).toBeTruthy();
    expect(queryByText('error.boundary_title')).toBeNull();
    expect(listErrors()).toEqual([]);
  });

  it('un error POSTERIOR al montaje también se contiene', () => {
    // No es lo mismo que romperse al montar: es el caso real —un toque que
    // dispara un render que tira— y pasa por el mismo camino de React.
    function RompeAlTocar() {
      const [roto, setRoto] = useState(false);
      if (roto) throw new Error('se rompió al tocar');
      return <Pressable onPress={() => setRoto(true)}><Text>tocame</Text></Pressable>;
    }

    const { getByText } = render(
      <ErrorBoundary textos={TEXTOS}><RompeAlTocar /></ErrorBoundary>,
    );

    fireEvent.press(getByText('tocame'));

    expect(getByText('error.boundary_title')).toBeTruthy();
    expect(listErrors()[0]).toMatchObject({ message: 'se rompió al tocar', fatal: true });
  });
});
