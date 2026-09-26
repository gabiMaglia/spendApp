import React from 'react';
import { render } from '@testing-library/react-native';

import { SinSesionDeSync } from '@/src/components/SinSesionDeSync';

describe('SinSesionDeSync (T-147, enmienda PO)', () => {
  it('sin sesión, avisa que este teléfono no está sincronizando', () => {
    const { getByText } = render(<SinSesionDeSync sinSesion />);
    expect(getByText('sync.no_session_title')).toBeTruthy();
    expect(getByText('sync.no_session_body')).toBeTruthy();
  });

  it('con sesión, no dibuja nada', () => {
    const { queryByText } = render(<SinSesionDeSync sinSesion={false} />);
    expect(queryByText('sync.no_session_title')).toBeNull();
  });
});
