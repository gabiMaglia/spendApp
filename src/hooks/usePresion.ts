import { useCallback } from 'react';
import { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { ESCALA_PRESION, RESORTE_MARCA } from '@/src/constants/movimiento';
import { useAnimacionesReducidas } from '@/src/hooks/useAnimacionesReducidas';

/**
 * El feedback de presión de toda la app: achica un poco mientras el dedo está encima y
 * vuelve con el resorte de la marca. Con «reducir movimiento» no escala nada.
 * Lo usa `PresionableEscala`; no se enchufa a mano en cada pantalla.
 */
export function usePresion() {
  const escala = useSharedValue(1);
  const reducido = useAnimacionesReducidas();

  const alPresionar = useCallback(() => {
    if (reducido === true) return;
    escala.value = withSpring(ESCALA_PRESION, RESORTE_MARCA);
  }, [reducido, escala]);

  const alSoltar = useCallback(() => {
    if (reducido === true) return;
    escala.value = withSpring(1, RESORTE_MARCA);
  }, [reducido, escala]);

  const estiloEscala = useAnimatedStyle(() => ({ transform: [{ scale: escala.value }] }));

  return { alPresionar, alSoltar, estiloEscala };
}
