import { useMemo } from 'react';
import type { ViewStyle } from 'react-native';
import { useSkin } from '@/src/skins/useSkin';

/**
 * Estilo extra para `Fab` según el skin. `undefined` con el default: el FAB
 * queda con su sombra de siempre. Con un skin `soft`, radio del skin y —sin
 * degradar— la sombra `e3` más un glow de marca en el primario.
 */
export function useFabSkinStyle(variant: 'primary' | 'secondary'): ViewStyle | undefined {
  const { skin, degradado } = useSkin();
  return useMemo(() => {
    if (!skin.flags.soft) return undefined;
    const e3 = skin.elevation.e3;
    const e1 = skin.elevation.e1;
    if (degradado) {
      return {
        borderRadius: skin.radius.fab,
        boxShadow: 'none',
        elevation: variant === 'primary' ? e3.elevationFallback : e1.elevationFallback,
      };
    }
    return {
      borderRadius: skin.radius.fab,
      boxShadow: variant === 'primary' ? `${e3.boxShadow}, 0 0 24px ${skin.colors.glowStrong}` : e1.boxShadow,
    };
  }, [skin, degradado, variant]);
}
