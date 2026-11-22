import React from 'react';
import { render } from '@testing-library/react-native';

import { IconoCategoria } from '@/src/components/IconoCategoria';
import { CuboIcono } from '@/src/components/CuboIcono';
import { CategoryIcon } from '@/src/components/CategoryIcon';
import { CATEGORIES } from '@/src/screens/expense/repartoDeGasto';

describe('IconoCategoria', () => {
  it.each(CATEGORIES.map(c => c.id))('dibuja el ícono propio de %s', id => {
    const { getByTestId } = render(<IconoCategoria categoria={id} tinte="#e80" sobreColor="#fff" />);
    expect(getByTestId(`icono-categoria-${id}-a`)).toBeTruthy();
  });

  it('con un id desconocido cae a «other»', () => {
    const { getByTestId } = render(<IconoCategoria categoria="no-existe" tinte="#e80" sobreColor="#fff" />);
    expect(getByTestId('icono-categoria-other-a')).toBeTruthy();
  });

  it('el ingreso tiene su propio ícono', () => {
    const { getByTestId } = render(<IconoCategoria categoria="income" tinte="#2a7" sobreColor="#fff" />);
    expect(getByTestId('icono-categoria-income-a')).toBeTruthy();
  });

  it('expone la variante dibujada (a por defecto)', () => {
    const a = render(<IconoCategoria categoria="food" tinte="#e80" sobreColor="#fff" />);
    expect(a.getByTestId('icono-categoria-food-a')).toBeTruthy();
    const b = render(<IconoCategoria categoria="food" tinte="#e80" sobreColor="#fff" variante="b" />);
    expect(b.getByTestId('icono-categoria-food-b')).toBeTruthy();
  });
});

describe('CuboIcono con categoria', () => {
  it('sin resaltar dibuja la variante a; resaltado, la b', () => {
    const a = render(<CuboIcono categoria="taxes" tinte="#7e9461" />);
    expect(a.getByTestId('icono-categoria-taxes-a')).toBeTruthy();
    const b = render(<CuboIcono categoria="taxes" tinte="#7e9461" resaltado />);
    expect(b.getByTestId('icono-categoria-taxes-b')).toBeTruthy();
  });

  it('el contrato de monedas y fechas no cambia: texto no dibuja ícono de categoría', () => {
    const { queryByTestId, getByText } = render(<CuboIcono texto="$" tinte="#123456" />);
    expect(getByText('$')).toBeTruthy();
    expect(queryByTestId('icono-categoria-other-a')).toBeNull();
  });
});

describe('CategoryIcon (filas y detalle del gasto)', () => {
  it('usa el ícono propio, en variante a', () => {
    const { getByTestId } = render(<CategoryIcon kind="health" size={42} />);
    expect(getByTestId('icono-categoria-health-a')).toBeTruthy();
  });

  it.each(['income', 'salary', 'freelance'])('la categoría personal de ingreso %s usa el ícono de ingreso', k => {
    const { getByTestId } = render(<CategoryIcon kind={k as never} />);
    expect(getByTestId('icono-categoria-income-a')).toBeTruthy();
  });

  it('una categoría desconocida cae a «other»', () => {
    const { getByTestId } = render(<CategoryIcon kind={'zzz' as never} />);
    expect(getByTestId('icono-categoria-other-a')).toBeTruthy();
  });
});
