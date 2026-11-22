import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';

// Geometría de un check de 64 px: dos trazos que arrancan en el vértice.
const LADO = 64;
const GROSOR = 6;
const TRAZO_CORTO = { x: 16, y: 34, largo: 15, grados: 45 };
const TRAZO_LARGO = { x: 29, y: 47, largo: 31, grados: -50 };
const MS_CORTO = 140;
const MS_LARGO = 240;

type Props = {
  color: string;
  /** Sin animar: nace dibujado (reducir movimiento). */
  quieto?: boolean;
  testID?: string;
};

/**
 * Un tilde que se "dibuja" trazo a trazo. Sin `react-native-svg`: cada trazo es
 * una barra rotada cuyo ancho crece desde el vértice, así no hay dependencia
 * nativa extra y la animación corre en el hilo de UI con Reanimated.
 */
export function CheckDibujado({ color, quieto = false, testID }: Props) {
  const corto = useSharedValue(quieto ? 1 : 0);
  const largo = useSharedValue(quieto ? 1 : 0);

  useEffect(() => {
    if (quieto) { corto.value = 1; largo.value = 1; return; }
    corto.value = withTiming(1, { duration: MS_CORTO });
    largo.value = withDelay(MS_CORTO, withTiming(1, { duration: MS_LARGO }));
  }, [quieto, corto, largo]);

  const estiloCorto = useAnimatedStyle(() => ({ width: TRAZO_CORTO.largo * corto.value }));
  const estiloLargo = useAnimatedStyle(() => ({ width: TRAZO_LARGO.largo * largo.value }));

  return (
    <View
      testID={testID}
      style={styles.caja}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Trazo def={TRAZO_CORTO} color={color} estilo={estiloCorto} />
      <Trazo def={TRAZO_LARGO} color={color} estilo={estiloLargo} />
    </View>
  );
}

function Trazo({ def, color, estilo }: {
  def: typeof TRAZO_CORTO; color: string; estilo: object;
}) {
  return (
    <View
      style={[
        styles.trazo,
        { left: def.x, top: def.y - GROSOR / 2, transform: [{ rotate: `${def.grados}deg` }] },
      ]}
    >
      <Animated.View style={[styles.relleno, { backgroundColor: color }, estilo]} />
    </View>
  );
}

const styles = StyleSheet.create({
  caja:    { width: LADO, height: LADO },
  // El giro es alrededor del vértice (borde izquierdo), no del centro.
  trazo:   { position: 'absolute', height: GROSOR, transformOrigin: ['0%', '50%', 0] },
  relleno: { height: GROSOR, borderRadius: GROSOR / 2 },
});
