import React from 'react';
import { render } from '@testing-library/react-native';
import { FilaDeTotal } from '@/src/components/FilaDeTotal';

/**
 * T-225: la fila de total del pie de Grupos, extraída para usarla también como
 * balance neto al pie del detalle de grupo. Se prueba qué muestra, no cómo se ve.
 */
const monto = (r: ReturnType<typeof render>, id: string) => r.UNSAFE_getByProps({ id }).props;

describe('FilaDeTotal', () => {
  it('muestra la etiqueta y el monto con su id (para que ruede)', () => {
    const r = render(<FilaDeTotal testID="fila" label="Total" minor={14_000} code="ARS" id="x.total" />);
    expect(r.getByTestId('fila')).toBeTruthy();
    expect(r.getByText('Total')).toBeTruthy();
    expect(monto(r, 'x.total')).toMatchObject({ minor: 14_000, code: 'ARS', prefix: '' });
  });

  it('un total negativo lleva el signo menos', () => {
    const r = render(<FilaDeTotal label="Total" minor={-6_000} code="ARS" id="x.total" />);
    expect(monto(r, 'x.total')).toMatchObject({ minor: -6_000, prefix: '-' });
  });

  it('en cero no lleva signo', () => {
    const r = render(<FilaDeTotal label="Total" minor={0} code="USD" id="x.total" />);
    expect(monto(r, 'x.total')).toMatchObject({ minor: 0, prefix: '' });
  });
});
