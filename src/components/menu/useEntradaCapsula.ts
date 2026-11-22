import { useEffect } from 'react';
import { useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';

import { DURACION, ESCALONADO_MS, RESORTE_MARCA } from '@/src/constants/movimiento';

const DEMORA_ETIQUETA_MS = 70;

/**
 * El tiempo de una cápsula del abanico: `p` es el viaje (spring escalonado por índice) y
 * `l` el nombre, que se funde un poco después. Lo comparten la columna y la fila.
 * Salida: más corta que `SALIDA_MS`, que es la que desmonta (no depende del callback de cada cubo).
 */
export function useEntradaCapsula({ indice, visible, entrar, sinAnimacion }: {
  indice: number; visible: boolean; entrar: boolean; sinAnimacion: boolean;
}) {
  const p = useSharedValue(0);
  const l = useSharedValue(0);

  useEffect(() => {
    if (visible && entrar) {
      if (sinAnimacion) {
        p.value = withTiming(1, { duration: DURACION.fundido });
        l.value = withTiming(1, { duration: DURACION.fundido });
      } else {
        const demora = indice * ESCALONADO_MS;
        p.value = withDelay(demora, withSpring(1, RESORTE_MARCA));
        l.value = withDelay(demora + DEMORA_ETIQUETA_MS, withTiming(1, { duration: DURACION.corta }));
      }
    } else if (!visible) {
      // Con reducir movimiento el Modal se desmonta a los 90 ms: el fundido dura lo mismo.
      const ms = sinAnimacion ? DURACION.fundido : DURACION.salida - 10;
      p.value = withTiming(0, { duration: ms });
      l.value = withTiming(0, { duration: ms });
    }
  }, [visible, entrar, sinAnimacion, indice, p, l]);

  return { p, l };
}
