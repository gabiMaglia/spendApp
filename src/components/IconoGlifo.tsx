import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { conAlfa } from '@/src/skins/color';
import { GLIFOS, type IdGlifo } from '@/src/components/glifos';
import type { DibujoCategoria } from '@/src/components/iconosCategoria';

export type ModoGlifo = 'trazo' | 'tonos';

/**
 * Glifo propio (T-294): `trazo` = sólo línea; `tonos` = forma con relleno suave + trazo.
 * Decorativo: el label accesible lo da el botón o la fila que lo contiene.
 */
function IconoGlifoBase({ glifo, color, modo, tamano = 24, grosor = 1.8 }: {
  glifo: IdGlifo;
  color: string;
  modo: ModoGlifo;
  tamano?: number;
  grosor?: number;
}) {
  const { b, d }: DibujoCategoria = GLIFOS[glifo];
  return (
    <View testID={`icono-glifo-${glifo}-${modo}`} accessible={false}>
      <Svg width={tamano} height={tamano} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {b !== '' && (
          <Path d={b} strokeWidth={grosor} stroke={color} fill={modo === 'tonos' ? conAlfa(color, 0.26) : 'none'} />
        )}
        {d !== '' && <Path d={d} strokeWidth={grosor} stroke={color} fill="none" />}
      </Svg>
    </View>
  );
}

export const IconoGlifo = React.memo(IconoGlifoBase);
