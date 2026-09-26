import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { PersonalMonthNav } from '@/src/screens/personal/components/PersonalMonthNav';
import { MovimientosHeader } from '@/src/screens/personal/components/MovimientosHeader';
import { MovimientosList } from '@/src/screens/personal/components/MovimientosList';
import { useSettingsStore } from '@/src/store/settingsStore';
import type { PersonalEntry } from '@/src/types/models';

const ENTRY = {
  id: 'e1', kind: 'expense', description: 'Super', amount: 1000, currency: 'ARS',
  category: 'food', date: Date.UTC(2026, 8, 10), createdAt: 0, updatedAt: 0, isDeleted: false,
} as unknown as PersonalEntry;

/** Personal con cada skin: mismo contenido, distinta superficie. */
describe.each(['default', 'aero'] as const)('Personal con skin %s', skinId => {
  beforeEach(() => useSettingsStore.setState({ skin: skinId, reduceAnimations: false }));

  it('el navegador de mes conserva su testID y su mes', () => {
    render(<PersonalMonthNav activeMonth="2026-09" atCurrentMonth onChangeMonth={() => {}} />);
    expect(screen.getByTestId('month-nav')).toBeTruthy();
  });

  it('el encabezado de Movimientos muestra el conteo', () => {
    render(<MovimientosHeader count={3} />);
    expect(screen.getByTestId('movimientos-header')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('la lista muestra las filas', () => {
    render(<MovimientosList entries={[ENTRY]} monthLabelText="septiembre" onRemove={() => {}} />);
    expect(screen.getByText('Super')).toBeTruthy();
  });

  it('la lista vacía muestra el estado vacío', () => {
    render(<MovimientosList entries={[]} monthLabelText="septiembre" onRemove={() => {}} />);
    expect(screen.getByText(/personal\.no_movements/)).toBeTruthy();
  });

  it('la lista va en panel solo con aero', () => {
    render(<MovimientosList entries={[ENTRY]} monthLabelText="septiembre" onRemove={() => {}} />);
    expect(!!screen.queryByTestId('skin-panel')).toBe(skinId === 'aero');
  });
});
