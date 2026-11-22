import { useCallback, useEffect, useRef, useState } from 'react';
import {
  runOnJS, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';

import { CURVA, DURACION } from '@/src/constants/movimiento';
import { useAnimacionesReducidas } from '@/src/hooks/useAnimacionesReducidas';
import type { Posicion } from '@/src/components/menu/tipos';

export const ENTRADA_MS = DURACION.corta;
export const SALIDA_MS = DURACION.salida;
export const FUNDIDO_MS = DURACION.fundido;
const ESCALA_INICIAL = 0.92;

/**
 * Animación del menú con shared values (R4: nada de `entering`/`exiting`, el
 * desmontaje dentro de un Modal no es fiable en Android). `montado` se suelta
 * en el callback de salida, igual que en `BottomSheet`.
 * Con «reducir movimiento»: sólo fundido corto, sin escala.
 */
export function useAnimacionMenu({ visible, listo, lado }: {
  visible: boolean;
  /** Ya hay posición: recién ahí se anima la entrada. */
  listo: boolean;
  lado: Posicion['lado'] | undefined;
}) {
  const sinAnimacion = useAnimacionesReducidas() === true;
  const [montado, setMontado] = useState(visible);
  const velo = useSharedValue(0);
  const menu = useSharedValue(0);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  // ¿Arrancó alguna vez la entrada? (el valor compartido no se puede leer fiable en tests)
  const entroRef = useRef(false);
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);

  // Un callback viejo no puede desmontar un menú que ya se reabrió.
  const soltar = useCallback(() => {
    if (vivo.current && !visibleRef.current) { entroRef.current = false; setMontado(false); }
  }, []);

  useEffect(() => {
    if (visible) {
      setMontado(true);
      if (listo) {
        entroRef.current = true;
        const ms = sinAnimacion ? FUNDIDO_MS : ENTRADA_MS;
        velo.value = withTiming(1, { duration: ms });
        menu.value = withTiming(1, { duration: ms, easing: CURVA.entrar });
      }
      return;
    }
    // Nunca llegó a mostrarse: withTiming sobre un valor que ya está en 0 no
    // garantiza su callback y el Modal invisible quedaría montado tragándose toques.
    if (!entroRef.current) { setMontado(false); return; }
    const ms = sinAnimacion ? FUNDIDO_MS : SALIDA_MS;
    velo.value = withTiming(0, { duration: ms });
    menu.value = withTiming(0, { duration: ms, easing: CURVA.salir }, (fin) => {
      if (fin) runOnJS(soltar)();
    });
  }, [visible, listo, sinAnimacion, velo, menu, soltar]);

  const estiloVelo = useAnimatedStyle(() => ({ opacity: velo.value }));
  const estiloMenu = useAnimatedStyle(() => ({
    opacity: menu.value,
    ...(sinAnimacion ? null : { transform: [{ scale: ESCALA_INICIAL + (1 - ESCALA_INICIAL) * menu.value }] }),
  }));
  // Crece desde el borde que toca el ancla.
  const origen = lado === 'arriba' ? 'bottom' : 'top';

  return { montado, sinAnimacion, estiloVelo, estiloMenu, origen } as const;
}
