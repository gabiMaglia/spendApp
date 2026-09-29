import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { Panel } from '@/src/components/skin/Panel';
import { useSettingsStore } from '@/src/store/settingsStore';

/**
 * T-154 (3ra vuelta — decisión del orquestador): Actividad vuelve a ítem
 * = FILA, pero con el panel Aero SEGMENTADO por fila (no un Panel completo
 * por fila) — `primera`/`media`/`ultima`/`unica` arman entre todas UNA sola
 * tarjeta continua (radio sólo en las puntas, divisor entre filas, sombra
 * recortada por segmento para no pisar al vecino).
 */
describe('Panel con segmento (Aero)', () => {
  it('con Aero, segmento="primera" no tiene divisor arriba', () => {
    useSettingsStore.setState({ skin: 'aero' });
    render(<Panel segmento="primera"><Text>a</Text></Panel>);
    expect(screen.getByTestId('skin-panel-primera')).toBeTruthy();
    expect(screen.queryByTestId('band-stack-divisor')).toBeNull();
  });

  it('con Aero, segmento="media" tiene un divisor arriba', () => {
    useSettingsStore.setState({ skin: 'aero' });
    render(<Panel segmento="media"><Text>b</Text></Panel>);
    expect(screen.getByTestId('skin-panel-media')).toBeTruthy();
    expect(screen.getByTestId('band-stack-divisor')).toBeTruthy();
  });

  it('con Aero, segmento="ultima" tiene un divisor arriba', () => {
    useSettingsStore.setState({ skin: 'aero' });
    render(<Panel segmento="ultima"><Text>c</Text></Panel>);
    expect(screen.getByTestId('skin-panel-ultima')).toBeTruthy();
    expect(screen.getByTestId('band-stack-divisor')).toBeTruthy();
  });

  it('con Aero, segmento="unica" no tiene divisor', () => {
    useSettingsStore.setState({ skin: 'aero' });
    render(<Panel segmento="unica"><Text>d</Text></Panel>);
    expect(screen.getByTestId('skin-panel-unica')).toBeTruthy();
    expect(screen.queryByTestId('band-stack-divisor')).toBeNull();
  });

  it('con el Clásico, segmento no cambia nada (sin skin-panel-*)', () => {
    useSettingsStore.setState({ skin: 'default' });
    render(<Panel segmento="primera"><Text>e</Text></Panel>);
    expect(screen.getByText('e')).toBeTruthy();
    expect(screen.queryByTestId('skin-panel')).toBeNull();
    expect(screen.queryByTestId('skin-panel-primera')).toBeNull();
    expect(screen.queryByTestId('band-stack-divisor')).toBeNull();
  });

  it('sin segmento (default), el comportamiento existente sigue intacto', () => {
    useSettingsStore.setState({ skin: 'aero' });
    render(<Panel><Text>f</Text></Panel>);
    expect(screen.getByTestId('skin-panel')).toBeTruthy();
    expect(screen.queryByTestId('band-stack-divisor')).toBeNull();
  });

  afterEach(() => {
    useSettingsStore.setState({ skin: 'default' });
  });
});
