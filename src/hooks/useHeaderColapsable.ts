import {
  useAnimatedScrollHandler, useSharedValue, type SharedValue,
} from 'react-native-reanimated';

import { TITLE_BLOCK_H } from '@/src/components/CollapsibleHeader';

/**
 * **Header colapsable de las seis tabs** (T-128, pedido del PO 2026-09-13,
 * probando en el teléfono).
 *
 * Matemática pura primero (`progresoColapso`, `alturaHeaderColapsable`,
 * `alturaBloqueTituloVisible`, `opacidadTituloCompacto`): sin esto no hay
 * forma de testear el colapso sin renderizar Reanimated de por medio. El
 * hook de abajo es la única pieza que toca la librería nativa.
 *
 * **Por qué un hook y no cada pantalla repitiendo `useSharedValue` +
 * `useAnimatedScrollHandler`:** son seis tabs con el mismo header
 * (`CollapsibleHeader`, T-114). Antes de T-128 cada una tenía su propio
 * `useRef(new Animated.Value(0))` de React Native — legible, pero corre en
 * el hilo de JS y dispara un `setState` conceptual en cada frame del scroll
 * (`useNativeDriver: false`, porque interpolaba `backgroundColor`). El pedido
 * del PO es "supersmooth" y "cero re-renders de React por frame": con
 * Reanimated, `scrollY`/`progress` viven en el hilo de UI y el scroll handler
 * no dispara ningún render de React.
 */

/**
 * Progreso de colapso en [0, 1] a partir del scroll acumulado.
 *
 * En `scrollY = 0` el header está expandido (0). Con
 * `scrollY >= (expandido - colapsado)` queda colapsado (1). Clampeado en los
 * dos extremos: el overscroll de iOS (scroll negativo al pull-to-refresh o
 * rebotar arriba) nunca empuja el progreso fuera de [0,1] — es la garantía de
 * que el header no se pasa del alto expandido ni se hunde debajo del
 * colapsado en ningún frame.
 */
export function progresoColapso(scrollY: number, expandido: number, colapsado: number): number {
  const distancia = expandido - colapsado;
  if (distancia <= 0) return 0;
  return Math.min(1, Math.max(0, scrollY / distancia));
}

/** Alto interpolado del header según el progreso de colapso. */
export function alturaHeaderColapsable(progreso: number, expandido: number, colapsado: number): number {
  const p = Math.min(1, Math.max(0, progreso));
  return expandido - p * (expandido - colapsado);
}

/**
 * Cuánto del bloque título (saludo + título grande) queda visible, en pt,
 * dado el alto ACTUAL del header.
 *
 * No hay fade propio acá (corrección del PO, T-128): el bloque título no
 * anima opacidad ni traslado por su cuenta, sólo queda recortado por el
 * `overflow: hidden` del header a medida que este pierde alto. Esta función
 * es la versión pura de ese recorte — 0 cuando el header está del todo
 * colapsado (ni el título ni, en Inicio, el saludo se ven), el alto completo
 * del bloque cuando está expandido.
 */
export function alturaBloqueTituloVisible(
  alturaHeaderActual: number, insetsTop: number, barH: number, tituloBlockH: number,
): number {
  return Math.min(tituloBlockH, Math.max(0, alturaHeaderActual - insetsTop - barH));
}

/**
 * Opacidad del título chico que aparece junto a la foto de perfil, en la fila
 * de botones. A diferencia del bloque título grande, ESTE sí tiene fade
 * propio (pedido explícito del PO) — sincronizado 1:1 con el progreso de
 * colapso: invisible expandido, opaco del todo colapsado.
 */
export function opacidadTituloCompacto(progreso: number): number {
  return Math.min(1, Math.max(0, progreso));
}

export type UseHeaderColapsableOptions = {
  /** Distancia de scroll, en pt, para pasar de expandido a colapsado. Por defecto el alto del bloque título. */
  distanciaColapso?: number;
};

/**
 * Hook compartido: shared value de progreso (hilo de UI) + scroll handler
 * para el `Animated.ScrollView`/`Animated.FlatList` de Reanimated.
 *
 * Devuelve `progress`, no el `scrollY` crudo: `CollapsibleHeader` no necesita
 * saber la distancia de colapso de quien lo llama, sólo un número en [0,1].
 */
export function useHeaderColapsable(
  options: UseHeaderColapsableOptions = {},
): { scrollHandler: ReturnType<typeof useAnimatedScrollHandler>; progress: SharedValue<number> } {
  const distancia = options.distanciaColapso ?? TITLE_BLOCK_H;
  const progress = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      progress.value = progresoColapso(event.contentOffset.y, distancia, 0);
    },
  });

  return { scrollHandler, progress };
}
