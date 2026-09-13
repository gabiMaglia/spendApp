import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { SoloEnDesarrollo } from '@/src/components/SoloEnDesarrollo';

const redirigidoA: string[] = [];
jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => { redirigidoA.push(href); return null; },
}));

beforeEach(() => { redirigidoA.length = 0; });

describe('SoloEnDesarrollo', () => {
  it('en producción no dibuja la pantalla y manda al inicio', () => {
    const { queryByText } = render(
      <SoloEnDesarrollo isDev={false}><Text>debug</Text></SoloEnDesarrollo>,
    );
    expect(queryByText('debug')).toBeNull();
    expect(redirigidoA).toEqual(['/']);
  });

  it('en desarrollo la dibuja', () => {
    const { getByText } = render(
      <SoloEnDesarrollo isDev><Text>debug</Text></SoloEnDesarrollo>,
    );
    expect(getByText('debug')).toBeTruthy();
    expect(redirigidoA).toEqual([]);
  });
});
