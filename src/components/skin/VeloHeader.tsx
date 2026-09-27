import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { conAlfa } from '@/src/skins/color';
import { useSkinTokens } from '@/src/skins/useSkin';
import { RECORRIDO_AERO } from './headerAeroGeometria';

/** Cuánto baja el velo por debajo del borde del header (PO 2026-09-26). */
export const VELO_DEBAJO = 2;
/** Opacidad del velo (PO: «overlay al 30%»). */
export const VELO_OPACIDAD = 0.3;

/** Alto del velo: del borde de arriba de la pantalla hasta 2pt debajo del header. */
export function altoVelo(fondoBarra: number, altoTituloYAire: number): number {
  'worklet';
  return fondoBarra + altoTituloYAire + VELO_DEBAJO;
}

/**
 * **Velo detrás del header Aero** (PO 2026-09-26): desde el borde superior
 * hasta 2pt debajo del header, el color del fondo al 30%. El contenido que
 * sube se sigue viendo, atenuado, en los huecos alrededor de las tarjetas;
 * su borde de abajo acompaña al colapso.
 *
 * **Sin blur nativo, a propósito.** Se probó `expo-blur` (`dimezisBlurView`):
 * en Android tapa en vez de dejar ver (suma su propio tinte) y en Android 11
 * (Moto E40 del PO) usa RenderScript, que crashea con radio > 25. Un blur de
 * verdad en Android solo es confiable desde Android 12 (RenderEffect).
 */
export function VeloHeader({
  progress, fondoBarra,
}: {
  progress: SharedValue<number>;
  fondoBarra: number;
}) {
  const skin = useSkinTokens();
  const estilo = useAnimatedStyle(() => ({
    height: altoVelo(fondoBarra, RECORRIDO_AERO * (1 - Math.min(1, Math.max(0, progress.value)))),
  }));

  return (
    <Animated.View
      testID="velo-header"
      pointerEvents="none"
      style={[styles.velo, { backgroundColor: conAlfa(skin.colors.bg, VELO_OPACIDAD) }, estilo]}
    />
  );
}

const styles = StyleSheet.create({
  velo: { position: 'absolute', top: 0, left: 0, right: 0 },
});
