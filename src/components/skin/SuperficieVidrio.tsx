import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { conAlfa } from '@/src/skins/color';
import { useSkin } from '@/src/skins/useSkin';

/**
 * **Vidrio del Aero** (T-292): superficie que desenfoca lo que pasa por debajo.
 *
 * - iOS: `BlurView` real + un velo translúcido del skin y borde hairline claro.
 * - Android, o «reducir animaciones»/gama baja: SIN blur (el blur de Android
 *   cuesta frames y crasheó en Android 11); queda la superficie del skin con
 *   alfa alta para que el texto siga leyéndose sobre cualquier contenido.
 *
 * Es caro a propósito de usar una sola vez: lo monta la píldora de pestañas y
 * nada más. Un test cuida que no haya un segundo `BlurView` en el árbol.
 */
const ALFA_VELO_IOS = 0.38;
const ALFA_ANDROID = 0.92;
const INTENSIDAD = 40;

export function SuperficieVidrio({
  radio, children, style,
}: { radio: number; children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { skin, degradado } = useSkin();
  const oscuro = (useColorScheme() ?? 'light') === 'dark';
  const c = skin.colors;
  const borde = oscuro ? 'rgba(255,245,230,0.10)' : 'rgba(255,255,255,0.55)';
  const marco = { borderRadius: radio, borderWidth: StyleSheet.hairlineWidth, borderColor: borde };

  if (Platform.OS === 'ios' && !degradado) {
    return (
      <BlurView
        testID="superficie-vidrio-blur"
        tint={oscuro ? 'dark' : 'light'}
        intensity={INTENSIDAD}
        style={[StyleSheet.absoluteFill, styles.recorte, marco, style]}
      >
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: conAlfa(c.surface, ALFA_VELO_IOS) }]} />
        {children}
      </BlurView>
    );
  }

  return (
    <View
      testID="superficie-vidrio-translucida"
      style={[StyleSheet.absoluteFill, styles.recorte, marco, { backgroundColor: conAlfa(c.surface, ALFA_ANDROID) }, style]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  recorte: { overflow: 'hidden' },
});
