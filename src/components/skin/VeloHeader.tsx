import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { requireOptionalNativeModule } from 'expo-modules-core';

import { useSkin } from '@/src/skins/useSkin';
import { conAlfa } from '@/src/skins/color';
import { RECORRIDO_AERO } from './headerAeroGeometria';

/** Cuánto baja el velo por debajo del borde del header (PO 2026-09-26). */
export const VELO_DEBAJO = 2;
/** Opacidad del tinte del velo (PO: «overlay al 30%»). */
export const VELO_OPACIDAD = 0.3;

/**
 * `expo-blur` es nativo: si el dev client instalado todavía no lo trae, se
 * requiere solo cuando el módulo existe. Sin él, queda el tinte al 30% sin
 * blur (en vez de tumbar la pantalla con un error rojo).
 */
function blurDisponible(): React.ComponentType<Record<string, unknown>> | null {
  if (!requireOptionalNativeModule('ExpoBlurView')) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-blur').BlurView;
}
const BlurNativo = blurDisponible();

/** Alto del velo: del borde de arriba de la pantalla hasta 2pt debajo del header. */
export function altoVelo(fondoBarra: number, altoTituloYAire: number): number {
  'worklet';
  return fondoBarra + altoTituloYAire + VELO_DEBAJO;
}

/**
 * **Velo esmerilado detrás del header Aero** (PO 2026-09-26): desde el borde
 * superior hasta 2pt debajo del header, tinte del fondo al 30% con blur
 * fuerte. El contenido que sube se ve esmerilado en los huecos alrededor de
 * las tarjetas; su borde de abajo acompaña al colapso.
 *
 * Degradado (gama baja / reducir animaciones): sin blur, solo el tinte.
 */
export function VeloHeader({
  progress, fondoBarra,
}: {
  progress: SharedValue<number>;
  fondoBarra: number;
}) {
  const { skin, degradado } = useSkin();
  const estilo = useAnimatedStyle(() => ({
    height: altoVelo(fondoBarra, RECORRIDO_AERO * (1 - Math.min(1, Math.max(0, progress.value)))),
  }));
  const tinte = conAlfa(skin.colors.bg, VELO_OPACIDAD);

  return (
    <Animated.View testID="velo-header" pointerEvents="none" style={[styles.velo, estilo]}>
      {BlurNativo && !degradado ? (
        <BlurNativo
          style={StyleSheet.absoluteFill}
          intensity={90}
          tint="default"
          experimentalBlurMethod="dimezisBlurView"
        />
      ) : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tinte }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  velo: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
});
