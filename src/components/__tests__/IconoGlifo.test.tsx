import React from 'react';
import { render } from '@testing-library/react-native';

import { IconoGlifo } from '@/src/components/IconoGlifo';
import { IDS_GLIFO } from '@/src/components/glifos';

describe('IconoGlifo (T-294)', () => {
  it.each(IDS_GLIFO)('dibuja el glifo %s en trazo y en dos tonos', id => {
    const t = render(<IconoGlifo glifo={id} color="#345" modo="trazo" />);
    expect(t.getByTestId(`icono-glifo-${id}-trazo`)).toBeTruthy();
    const d = render(<IconoGlifo glifo={id} color="#345" modo="tonos" />);
    expect(d.getByTestId(`icono-glifo-${id}-tonos`)).toBeTruthy();
  });

  it('incluye las cuatro pestañas, los sellos y el saldar', () => {
    for (const id of ['personal', 'grupos', 'amigos', 'actividad', 'tacho', 'deshacer', 'todos']) {
      expect(IDS_GLIFO).toContain(id);
    }
  });

  it('es decorativo: no es accesible por sí mismo', () => {
    const { getByTestId } = render(<IconoGlifo glifo="tacho" color="#345" modo="trazo" />);
    expect(getByTestId('icono-glifo-tacho-trazo').props.accessible).toBe(false);
  });
});
