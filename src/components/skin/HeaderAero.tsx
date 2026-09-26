import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/src/constants/spacing';
import { HEADER_BAR_H, TITLE_BOTTOM_GAP } from '@/src/constants/header';
import { FondoMarmol } from '@/src/components/FondoMarmol';
import { useSkinTokens } from '@/src/skins/useSkin';
import {
  opacidadTituloCompacto, opacidadTituloCompactoSinMovimiento,
  opacidadTituloGrande, opacidadTituloGrandeSinMovimiento,
} from '@/src/hooks/useHeaderColapsable';
import { VidrioMarmol } from './VidrioMarmol';
import {
  AERO_RADIO, AERO_TOPE, aireEntreTarjetas, altoTarjetaTitulo, radioEnfrentado,
  radioInferiorBarra, TITULO_AERO_H, unidas,
} from './headerAeroGeometria';

/** Dónde termina la barra, medido desde arriba de la pantalla. */
export function fondoBarraAero(insetsTop: number): number {
  return insetsTop + AERO_TOPE + HEADER_BAR_H;
}

/**
 * **Header del skin Aero** (PO 2026-09-26). Reemplaza al `CollapsibleHeader`
 * solo cuando el skin es `soft`; el del skin default no se toca.
 *
 * Dos tarjetas de mármol con vidrio, con margen a los costados y fuera de la
 * status bar: la barra de botones (fija) y la del título. Al scrollear se
 * acercan, se funden en una y la del título se achica hasta desaparecer (ver
 * `headerAeroGeometria.ts`). Recorrido `RECORRIDO_AERO`: `useHeaderColapsable`,
 * `useHeaderPadding` y `useLimiteContenido` lo toman del skin.
 */
export function HeaderAero({
  title, subtitle, progress, right, left,
}: {
  title: string;
  subtitle?: string;
  progress: SharedValue<number>;
  right?: React.ReactNode;
  left?: React.ReactNode;
}) {
  const skin = useSkinTokens();
  const c = skin.colors;
  const insets = useSafeAreaInsets();
  const reducirMovimiento = useReducedMotion();
  const barraTop = insets.top + AERO_TOPE;
  const barraBottom = barraTop + HEADER_BAR_H;
  const tarjeta = {
    backgroundColor: c.surface,
    borderColor: c.hair,
    marginHorizontal: skin.space.inset,
  };

  const barraStyle = useAnimatedStyle(() => {
    const r = radioInferiorBarra(progress.value);
    return {
      borderBottomLeftRadius: r,
      borderBottomRightRadius: r,
      borderBottomWidth: unidas(progress.value) ? 0 : 1,
    };
  });

  const tituloStyle = useAnimatedStyle(() => {
    const r = radioEnfrentado(progress.value);
    const alto = altoTarjetaTitulo(progress.value, TITULO_AERO_H);
    return {
      top: barraBottom + aireEntreTarjetas(progress.value),
      height: alto,
      borderTopLeftRadius: r,
      borderTopRightRadius: r,
      borderTopWidth: unidas(progress.value) ? 0 : 1,
      // Sin alto no queda nada que mostrar, ni siquiera el borde.
      opacity: alto < 1 ? 0 : 1,
    };
  });

  const textoTituloStyle = useAnimatedStyle(() => ({
    opacity: reducirMovimiento
      ? opacidadTituloGrandeSinMovimiento(progress.value)
      : opacidadTituloGrande(progress.value),
  }));

  const tituloCompactoStyle = useAnimatedStyle(() => ({
    opacity: reducirMovimiento
      ? opacidadTituloCompactoSinMovimiento(progress.value)
      : opacidadTituloCompacto(progress.value),
  }));

  return (
    <View testID="header-aero" style={[StyleSheet.absoluteFill, styles.capa]} pointerEvents="box-none">
      {/* Tarjeta del título: debajo de la barra en el orden de dibujo, así al fundirse la barra queda encima. */}
      <Animated.View
        testID="header-aero-titulo"
        style={[styles.tarjeta, tarjeta, styles.titulo, tituloStyle]}
        pointerEvents="none"
      >
        <FondoMarmol style={styles.marmolTitulo} />
        <VidrioMarmol />
        <Animated.View style={[styles.bloqueTitulo, textoTituloStyle]}>
          {subtitle ? (
            <Text testID="header-subtitle" numberOfLines={1} style={[styles.subtitle, { color: c.textTertiary }]}>
              {subtitle}
            </Text>
          ) : null}
          <Text numberOfLines={1} style={[styles.title, { color: c.text }]}>{title}</Text>
        </Animated.View>
      </Animated.View>

      <Animated.View
        testID="header-aero-barra"
        style={[styles.tarjeta, tarjeta, { top: barraTop, height: HEADER_BAR_H }, barraStyle]}
      >
        <FondoMarmol patron="franja" />
        <VidrioMarmol />
        <View style={styles.fila}>
          <View style={styles.izquierda}>
            {left}
            <Animated.Text
              testID="header-title-compact"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              numberOfLines={1}
              style={[styles.titleCompact, tituloCompactoStyle, { color: c.text }]}
            >
              {title}
            </Animated.Text>
          </View>
          <View style={styles.derecha}>{right}</View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  capa: { zIndex: 10 },
  tarjeta: {
    position: 'absolute', left: 0, right: 0,
    borderWidth: 1, borderRadius: AERO_RADIO, overflow: 'hidden',
  },
  titulo: { zIndex: 0 },
  // Alto fijo: la textura nunca se estira al achicarse la tarjeta, solo se ve menos.
  marmolTitulo: { top: 0, bottom: undefined, height: TITULO_AERO_H + 16 },
  bloqueTitulo: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    gap: 2, paddingHorizontal: Spacing.screenPad - 4, paddingBottom: TITLE_BOTTOM_GAP + 8,
  },
  fila: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad - 4,
  },
  izquierda: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  derecha: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  subtitle: { fontSize: 12.5, fontWeight: '500' },
  title: { fontSize: 20, fontWeight: '800' },
  titleCompact: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
});
