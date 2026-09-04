import React from 'react';
import { StyleProp, Text, View, ViewStyle } from 'react-native';

/**
 * La marca de spendApp: dos cuadrados redondeados superpuestos con una «S».
 *
 * Vivía adentro de `app/auth/index.tsx`. Salió acá cuando el splash animado
 * necesitó la misma marca: duplicar la geometría en dos archivos garantiza que
 * un día se separen. **`scripts/generar-iconos.py` reproduce estos mismos
 * números** para los íconos de las tiendas — si cambian acá, hay que correr el
 * script de nuevo.
 *
 * Los estilos opcionales existen para el splash, que anima cada pieza por
 * separado. Sin ellos el componente es estático y no depende de reanimated.
 */

/** Lado del cuadrado petróleo, sobre el lado de la marca. */
export const CUADRADO_A = 0.78;
export const RADIO_A = 0.26;
/** Lado del cuadrado verde. Va abajo a la derecha, así que arranca en 1 − lado. */
export const CUADRADO_B = 0.68;
export const RADIO_B = 0.22;
/** Dónde empieza el cuadrado verde: 1 − 0.68 = 0.32. */
export const INICIO_B = 1 - CUADRADO_B;
export const TIPO_S = 0.31;

export const COLOR_A = '#0A6E8F';
export const COLOR_B = '#8FBC94';

/**
 * Centro de la INTERSECCIÓN de los dos cuadrados, no de la caja de la marca.
 *
 * A ocupa [0, 0.78] y B [0.32, 1]: se cruzan en [0.32, 0.78], cuyo centro es
 * 0.55. Centrar la «S» en la caja (0.5) la deja visiblemente corrida hacia
 * arriba-izquierda respecto de la figura que el ojo lee como centro — se veía
 * así hasta el 2026-09-03.
 */
export const CENTRO_S = (INICIO_B + CUADRADO_A) / 2;
/** Lado de la intersección: 0.78 − 0.32 = 0.46. */
export const LADO_CRUCE = CUADRADO_A - INICIO_B;

/** Props que la marca le exige a la pieza con la que dibuja cada parte. */
export type PiezaProps = { style?: StyleProp<ViewStyle>; children?: React.ReactNode };

type Props = {
  size: number;
  /** Estilo animado del cuadrado petróleo (lo usa el splash). */
  estiloA?: StyleProp<ViewStyle>;
  /** Estilo animado del cuadrado verde. */
  estiloB?: StyleProp<ViewStyle>;
  /** Estilo animado de la «S». */
  estiloS?: StyleProp<ViewStyle>;
  /** Componente con el que se dibuja cada pieza. El splash pasa Animated.View. */
  Pieza?: React.ComponentType<PiezaProps>;
};

export function AppLogoMark({ size, estiloA, estiloB, estiloS, Pieza = View }: Props) {
  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      <Pieza
        style={[{
          position: 'absolute', left: 0, top: 0,
          width: size * CUADRADO_A, height: size * CUADRADO_A,
          borderRadius: size * RADIO_A, backgroundColor: COLOR_A,
        }, estiloA]}
      />
      <Pieza
        style={[{
          position: 'absolute', right: 0, bottom: 0,
          width: size * CUADRADO_B, height: size * CUADRADO_B,
          borderRadius: size * RADIO_B, backgroundColor: COLOR_B, opacity: 0.85,
        }, estiloB]}
      />
      <Pieza
        style={[{
          position: 'absolute',
          left: size * INICIO_B, top: size * INICIO_B,
          width: size * LADO_CRUCE, height: size * LADO_CRUCE,
          alignItems: 'center', justifyContent: 'center',
        }, estiloS]}
      >
        <Text style={{
          color: '#fff', fontSize: size * TIPO_S, fontWeight: '800', letterSpacing: -2,
        }}>
          S
        </Text>
      </Pieza>
    </View>
  );
}
