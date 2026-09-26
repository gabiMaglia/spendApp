import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSkin } from '@/src/skins/useSkin';

/**
 * **Vidrio sobre el mármol** (Aero, PO 2026-09-26): va ENCIMA de un
 * `FondoMarmol` atenuado (`vidrioMarmolOpacity`) y lo hace leer como una
 * superficie de vidrio lechoso y pulido, no como una foto pegada.
 *
 * Tres capas, todas gradientes nativos (`experimental_backgroundImage`, RN
 * 0.81 New Arch), sin blur:
 *  1. velo en degradé: casi transparente arriba (se ven las vetas), más
 *     opaco abajo (donde va el texto);
 *  2. brillo superior (gloss) en el 40% de arriba;
 *  3. tinte de marca que entra desde el borde inferior.
 *
 * Con un skin que no es `soft` no dibuja nada. Degradado (gama baja /
 * reducir animaciones): solo el velo, plano.
 */
export function VidrioMarmol() {
  const { skin, degradado } = useSkin();
  if (!skin.flags.soft) return null;
  const c = skin.colors;

  if (degradado) {
    return (
      <View
        testID="vidrio-marmol"
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: c.vidrioVeilBottom }]}
      />
    );
  }

  return (
    <View testID="vidrio-marmol" pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={[
          StyleSheet.absoluteFill,
          { experimental_backgroundImage: `linear-gradient(180deg, ${c.vidrioVeilTop}, ${c.vidrioVeilBottom})` },
        ]}
      />
      <View
        style={[
          styles.gloss,
          { experimental_backgroundImage: `linear-gradient(180deg, ${c.vidrioGloss}, transparent)` },
        ]}
      />
      <View
        style={[
          styles.tint,
          { experimental_backgroundImage: `linear-gradient(0deg, ${c.vidrioTint}, transparent)` },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gloss: { position: 'absolute', top: 0, left: 0, right: 0, height: '40%' },
  tint: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '45%' },
});
