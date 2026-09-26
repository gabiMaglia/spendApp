import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';
import { CollapsibleHeader } from '@/src/components/CollapsibleHeader';
import { useSettingsStore } from '@/src/store/settingsStore';
import {
  AERO_AIRE, AERO_RADIO, FUSION, REAPARECE,
  RECORRIDO_AERO, TITULO_AERO_H, aireEntreTarjetas, altoTarjetaTitulo, radioEnfrentado, radioInferiorBarra, unidas,
} from '@/src/components/skin/headerAeroGeometria';

describe('geometría del header Aero', () => {
  const R = 135;

  it('expandido: tarjetas separadas, redondeadas, título a alto completo', () => {
    expect(aireEntreTarjetas(0)).toBe(AERO_AIRE);
    expect(radioEnfrentado(0)).toBe(AERO_RADIO);
    expect(radioInferiorBarra(0)).toBe(AERO_RADIO);
    expect(altoTarjetaTitulo(0, R)).toBe(R);
    expect(unidas(0)).toBe(false);
  });

  it('al terminar la fusión: sin aire y con la costura plana', () => {
    expect(aireEntreTarjetas(FUSION)).toBe(0);
    expect(radioEnfrentado(FUSION)).toBe(0);
    expect(radioInferiorBarra((FUSION + REAPARECE) / 2)).toBe(0);
    expect(unidas((FUSION + REAPARECE) / 2)).toBe(true);
  });

  it('colapsado: sin título y la barra vuelve a redondearse', () => {
    expect(altoTarjetaTitulo(1, R)).toBe(0);
    expect(radioInferiorBarra(1)).toBe(AERO_RADIO);
    expect(unidas(1)).toBe(false);
  });

  it('el título se achica sin saltos y nunca es negativo', () => {
    let previo = Infinity;
    for (let i = 0; i <= 20; i++) {
      const alto = altoTarjetaTitulo(i / 20, R);
      expect(alto).toBeGreaterThanOrEqual(0);
      expect(alto).toBeLessThanOrEqual(previo);
      previo = alto;
    }
  });

  it('el borde de abajo del título baja 1:1 con el contenido (sin «fondo fantasma»)', () => {
    for (let i = 0; i <= 20; i++) {
      const p = i / 20;
      const bordeDesdeLaBarra = aireEntreTarjetas(p) + altoTarjetaTitulo(p, TITULO_AERO_H);
      // El contenido se desplaza RECORRIDO_AERO * p; el borde, lo mismo.
      expect(bordeDesdeLaBarra).toBeCloseTo(RECORRIDO_AERO * (1 - p), 6);
    }
  });

  it('tolera progreso fuera de [0,1]', () => {
    expect(altoTarjetaTitulo(-1, R)).toBe(R);
    expect(altoTarjetaTitulo(2, R)).toBe(0);
    expect(radioInferiorBarra(5)).toBe(AERO_RADIO);
  });
});

function Header() {
  const progress = useSharedValue(0);
  return <CollapsibleHeader title="Tus cuentas" subtitle="Hola, invitado" progress={progress} />;
}

describe('CollapsibleHeader según el skin', () => {
  it('con el default es el header de siempre', () => {
    useSettingsStore.setState({ skin: 'default' });
    render(<Header />);
    expect(screen.getByTestId('header-wrap')).toBeTruthy();
    expect(screen.queryByTestId('header-aero')).toBeNull();
  });

  it('con aero usa el header de dos tarjetas, con título y saludo', () => {
    useSettingsStore.setState({ skin: 'aero' });
    render(<Header />);
    expect(screen.getByTestId('header-aero')).toBeTruthy();
    expect(screen.queryByTestId('header-wrap')).toBeNull();
    expect(screen.getByText('Hola, invitado')).toBeTruthy();
    expect(screen.getAllByText('Tus cuentas').length).toBeGreaterThan(0);
  });
});
