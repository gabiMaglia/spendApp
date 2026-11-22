import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { conAlfa } from '@/src/skins/color';
import { DIBUJOS_CATEGORIA, idIconoCategoria } from '@/src/components/iconosCategoria';

export type VarianteIconoCategoria = 'a' | 'b';

/**
 * Ícono propio de una categoría (T-293). Sólo el dibujo: el cubo de fondo lo pone
 * `CuboIcono`. Variante `a` = dos tonos (relleno suave + trazo del color); `b` = la
 * forma principal en `sobreColor` y los detalles con el color de la categoría, para
 * la opción elegida sobre un cubo de color pleno.
 */
function IconoCategoriaBase({ categoria, tinte, sobreColor, tamano = 28, variante = 'a' }: {
  categoria: string;
  tinte: string;
  /** Blanco del skin (`sobreVelo`) sobre el color pleno; sólo lo usa la variante `b`. */
  sobreColor: string;
  tamano?: number;
  variante?: VarianteIconoCategoria;
}) {
  const id = idIconoCategoria(categoria);
  const { b, d } = DIBUJOS_CATEGORIA[id];
  const esB = variante === 'b';
  return (
    // Decorativo: el label accesible lo da la opción/botón que lo contiene. El testID deja observar la variante.
    <View testID={`icono-categoria-${id}-${variante}`} accessible={false}>
      <Svg width={tamano} height={tamano} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <Path
          d={b}
          strokeWidth={esB ? 1.6 : 1.8}
          stroke={esB ? sobreColor : tinte}
          fill={esB ? sobreColor : conAlfa(tinte, 0.3)}
        />
        {d !== '' && <Path d={d} strokeWidth={esB ? 1.6 : 1.8} stroke={tinte} fill="none" />}
      </Svg>
    </View>
  );
}

export const IconoCategoria = React.memo(IconoCategoriaBase);
