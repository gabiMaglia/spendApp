import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { SeccionDeGasto } from '@/src/screens/expenseDetail/components/SeccionDeGasto';
import { useSettingsStore } from '@/src/store/settingsStore';

describe('SeccionDeGasto en los dos skins', () => {
  afterEach(() => { useSettingsStore.setState({ skin: 'default' }); });

  const seccion = () => render(<SeccionDeGasto titulo="Tu balance"><Text>contenido</Text></SeccionDeGasto>);

  it('Aero: es una tarjeta del skin (con su margen lateral), no una banda pegada a los bordes', () => {
    useSettingsStore.setState({ skin: 'aero' });
    const r = seccion();
    expect(r.getByTestId('skin-panel')).toBeTruthy();
    expect(r.getByText('Tu balance')).toBeTruthy();
    expect(r.getByText('contenido')).toBeTruthy();
  });

  it('Clásico: banda sin panel, mismo contenido', () => {
    const r = seccion();
    expect(r.queryByTestId('skin-panel')).toBeNull();
    expect(r.getByText('Tu balance')).toBeTruthy();
    expect(r.getByText('contenido')).toBeTruthy();
  });
});
