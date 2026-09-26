import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StatCards } from '@/src/components/skin/StatCards';
import { useSettingsStore } from '@/src/store/settingsStore';

describe('StatCards', () => {
  beforeEach(() => useSettingsStore.setState({ skin: 'aero', reduceAnimations: false }));

  it('una tarjeta por cifra, con su etiqueta y su valor', () => {
    render(
      <StatCards
        rows={[
          [{ label: 'Ingreso', value: '+$100' }, { label: 'Grupos', value: '3' }],
          [{ label: 'Personal', value: '$40' }, { label: 'En grupos', value: '$20' }],
        ]}
      />,
    );
    expect(screen.getAllByTestId('stat-card')).toHaveLength(4);
    for (const txt of ['Ingreso', '+$100', 'Grupos', '3', 'Personal', '$40', 'En grupos', '$20']) {
      expect(screen.getByText(txt)).toBeTruthy();
    }
  });

  it('sin filas no dibuja tarjetas', () => {
    render(<StatCards rows={[]} />);
    expect(screen.queryAllByTestId('stat-card')).toHaveLength(0);
  });
});
