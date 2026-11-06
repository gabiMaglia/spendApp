import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { StatLead } from '@/src/components/Band';
import { useSettingsStore } from '@/src/store/settingsStore';

const caso = (onPress: () => void) => (
  <StatLead
    lead={{ label: 'Ingresos', value: '$0' }}
    leadRight={{ label: 'Grupos', value: '2', onPress }}
    items={[{ label: 'Gasto personal', value: '$1' }, { label: 'Gasto en grupos', value: '$2', onPress }]}
  />
);

describe.each(['default', 'aero'] as const)('StatLead con casilleros tocables (skin %s)', skin => {
  beforeEach(() => { useSettingsStore.setState({ skin }); });
  afterEach(() => { useSettingsStore.setState({ skin: 'default' }); });

  it('los casilleros con onPress son botones y lo disparan', () => {
    const onPress = jest.fn();
    const r = render(caso(onPress));
    fireEvent.press(r.getByRole('button', { name: 'Grupos' }));
    fireEvent.press(r.getByRole('button', { name: 'Gasto en grupos' }));
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('los que no tienen onPress no son botones', () => {
    const r = render(caso(jest.fn()));
    expect(r.queryByRole('button', { name: 'Ingresos' })).toBeNull();
    expect(r.queryByRole('button', { name: 'Gasto personal' })).toBeNull();
  });
});
