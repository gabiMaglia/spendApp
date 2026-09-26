import React from 'react';
import { View, type DimensionValue, type ViewStyle } from 'react-native';
import { Meter } from '@/src/components/Band';
import { conAlfa } from '@/src/skins/color';
import { useSkin } from '@/src/skins/useSkin';

const ALTO = 8;

/**
 * **Barra de progreso del skin.** Con el default es el `Meter` plano de
 * siempre. Con un skin `soft`: más alta, extremos redondeados y —sin
 * degradar— relleno con gradiente y un glow del mismo color.
 */
export function GlowMeter({ pct, color }: { pct: number; color: string }) {
  const { skin, degradado } = useSkin();
  if (!skin.flags.soft) return <Meter pct={pct} color={color} />;

  const ancho = `${Math.max(0, Math.min(pct, 1)) * 100}%` as DimensionValue;
  const efectos: ViewStyle | null = degradado ? null : {
    boxShadow: `0 0 8px ${conAlfa(color, 0.35)}`,
    experimental_backgroundImage: `linear-gradient(90deg, ${conAlfa(color, 0.75)}, ${color})`,
  };

  return (
    <View
      testID="glow-meter"
      style={{ height: ALTO, borderRadius: ALTO / 2, backgroundColor: skin.colors.surfaceSunken }}
    >
      <View
        style={[{ width: ancho, height: '100%', borderRadius: ALTO / 2, backgroundColor: color }, efectos]}
      />
    </View>
  );
}
