import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { AppLogoMark, PiezaProps } from './AppLogoMark';
import {
  DESPLAZAMIENTO,
  DURACION_MS,
  avanceCubos,
  opacidadCubos,
  opacidadS,
} from '@/src/algorithms/splashTiming';

/**
 * El splash animado: los cubos entran desde la esquina superior hacia el
 * centro, y cuando llegan a la superposición aparece la «S», que termina de
 * aparecer justo cuando termina el movimiento. Pedido del PO, 2026-09-04.
 *
 * El tiempo NO vive acá: vive en `src/algorithms/splashTiming.ts`, con tests.
 * Este componente sólo lo dibuja. El progreso se anima **lineal** a propósito
 * —la curva la aplica `avanceCubos`— porque si el easing lo pusiera
 * `withTiming`, se aplicaría dos veces y los instantes que los tests amarran
 * dejarían de corresponder con lo que se ve.
 *
 * El splash nativo de `app.json` es sólo un color: si además dibujara la marca,
 * el usuario la vería aparecer entera y enseguida re-animarse desde la esquina.
 * Ese color es negro en los dos temas, igual que acá.
 */

const HOLD_MS = 240;
const SALIDA_MS = 320;

export function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const { width } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  const lado = Math.min(width * 0.34, 160);
  const p = useSharedValue(0);
  const salida = useSharedValue(1);

  useEffect(() => {
    let vivo = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (vivo) setReduceMotion(v); })
      .catch(() => { if (vivo) setReduceMotion(false); });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (reduceMotion === null) return;   // todavía no sabemos: no arranques

    const cerrar = () => {
      salida.value = withDelay(HOLD_MS, withTiming(0, { duration: SALIDA_MS }, fin => {
        if (fin) runOnJS(onDone)();
      }));
    };

    if (reduceMotion) {
      // Con movimiento reducido no se anima nada: la marca ya está armada y
      // sólo se sale. Mostrarla igual evita el parpadeo de un fondo vacío.
      p.value = 1;
      cerrar();
      return;
    }

    p.value = withTiming(1, { duration: DURACION_MS, easing: Easing.linear }, fin => {
      if (fin) runOnJS(cerrar)();
    });
  }, [reduceMotion, onDone, p, salida]);

  // Los dos cubos viajan igual; sólo cambia la opacidad final, porque el verde
  // vive al 85% (es lo que lo deja ver el petróleo por debajo).
  const estiloA = useAnimatedStyle(() => {
    const d = -(1 - avanceCubos(p.value)) * DESPLAZAMIENTO * lado;
    return {
      opacity: opacidadCubos(p.value),
      transform: [{ translateX: d }, { translateY: d }],
    };
  });

  const estiloB = useAnimatedStyle(() => {
    const d = -(1 - avanceCubos(p.value)) * DESPLAZAMIENTO * lado;
    return {
      opacity: opacidadCubos(p.value) * 0.85,
      transform: [{ translateX: d }, { translateY: d }],
    };
  });

  const estiloS = useAnimatedStyle(() => ({ opacity: opacidadS(p.value) }));
  const estiloFondo = useAnimatedStyle(() => ({ opacity: salida.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.centro, estiloFondo]}
    >
      <View>
        <AppLogoMark
          size={lado}
          Pieza={Animated.View as unknown as React.ComponentType<PiezaProps>}
          estiloA={estiloA}
          estiloB={estiloB}
          estiloS={estiloS}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // El fondo es NEGRO siempre, con el tema que sea (decisión del PO, 04/09).
  // Tiene que coincidir con el `backgroundColor` del splash nativo en app.json,
  // en sus DOS variantes: si no coinciden, se ve un parpadeo al cambiar de la
  // pantalla nativa a esta.
  centro: {
    alignItems: 'center', justifyContent: 'center', zIndex: 10,
    backgroundColor: '#000000',
  },
});
