import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';

import { FundidoBorde } from '@/src/components/menu/FundidoBorde';

jest.mock('@/src/skins/useSkin', () => ({ useColors: () => ({ velo: '#000000' }) }));

function Montado({ y, max, alIzquierda }: { y: number; max: number; alIzquierda?: boolean }) {
  const scrollY = useSharedValue(y);
  return <FundidoBorde scrollY={scrollY} maxScroll={max} alIzquierda={alIzquierda} testID="fundido" />;
}

const opacidad = (t: ReturnType<typeof render>) =>
  StyleSheet.flatten(t.getByTestId('fundido').props.style).opacity;

describe('FundidoBorde: se apaga al llegar al final', () => {
  it('visible mientras queda lista por recorrer', () => {
    expect(opacidad(render(<Montado y={0} max={200} />))).toBe(1);
    expect(opacidad(render(<Montado y={150} max={200} />))).toBe(1);
  });

  it('se apaga en el final del scroll (con 1px de tolerancia)', () => {
    expect(opacidad(render(<Montado y={200} max={200} />))).toBe(0);
    expect(opacidad(render(<Montado y={199} max={200} />))).toBe(0);
  });

  it('con alIzquierda el final es el scroll 0', () => {
    expect(opacidad(render(<Montado y={0} max={200} alIzquierda />))).toBe(0);
    expect(opacidad(render(<Montado y={120} max={200} alIzquierda />))).toBe(1);
  });
});
