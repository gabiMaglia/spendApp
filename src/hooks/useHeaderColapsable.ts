import { useCallback, useState } from 'react';
import { useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import {
  useAnimatedScrollHandler, useSharedValue, type SharedValue,
} from 'react-native-reanimated';

import { TITLE_BLOCK_H } from '@/src/constants/header';
import { useSkinTokens } from '@/src/skins/useSkin';
import { RECORRIDO_AERO } from '@/src/components/skin/headerAeroGeometria';


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
  'worklet';
  const distancia = expandido - colapsado;
  if (distancia <= 0) return 0;
  return Math.min(1, Math.max(0, scrollY / distancia));
}

/**
 * Curva suave (smoothstep): arranca y termina despacio. El alto y los fades la usan en vez
 * del progreso lineal — el PO pidió el movimiento entero más suave (2026-09-13).
 */
export function suavizar(progreso: number): number {
  'worklet';
  const p = Math.min(1, Math.max(0, progreso));
  return p * p * (3 - 2 * p);
}

/**
 * Alto interpolado del header según el progreso de colapso — **lineal, 1:1 con el scroll**.
 *
 * T-131 (PO: «el elemento superior siempre termina adentro de la barra, no debería pasar;
 * el límite fijo»): el borde inferior del header tiene que acompañar EXACTO al contenido
 * mientras colapsa. Con curva o con más recorrido, el contenido subía más rápido que el
 * header se achicaba y se metía debajo de la barra. La suavidad queda en los fades.
 */
export function alturaHeaderColapsable(progreso: number, expandido: number, colapsado: number): number {
  'worklet';
  const p = Math.min(1, Math.max(0, progreso));
  return expandido - p * (expandido - colapsado);
}

/**
 * Opacidad del título grande (y del saludo en Inicio): se desvanece en la primera mitad
 * del colapso, suave, en vez de cortarse contra la fila de botones (PO: «desaparece muy
 * abrupto», 2026-09-13). Totalmente transparente antes de que el recorte lo alcance.
 */
export function opacidadTituloGrande(progreso: number): number {
  'worklet';
  return 1 - suavizar(Math.min(1, Math.max(0, progreso) / 0.5));
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
  'worklet';
  return Math.min(tituloBlockH, Math.max(0, alturaHeaderActual - insetsTop - barH));
}

/**
 * Opacidad del título chico que aparece junto a la foto de perfil, en la fila
 * de botones. A diferencia del bloque título grande, ESTE sí tiene fade
 * propio (pedido explícito del PO) — sincronizado 1:1 con el progreso de
 * colapso: invisible expandido, opaco del todo colapsado.
 */
export function opacidadTituloCompacto(progreso: number): number {
  'worklet';
  // Entra en la segunda mitad, cuando el grande ya se fue: nunca se ven los dos a la vez.
  return suavizar((Math.min(1, Math.max(0, progreso)) - 0.5) / 0.5);
}

/** Opacidad del título chico con «reducir movimiento»: sin fade, aparece recién colapsado (T-128). */
/** Con «reducir movimiento» el título grande no se desvanece: queda hasta estar colapsado. */
export function opacidadTituloGrandeSinMovimiento(progreso: number): number {
  'worklet';
  return progreso >= 1 ? 0 : 1;
}

export function opacidadTituloCompactoSinMovimiento(progreso: number): number {
  'worklet';
  return progreso >= 1 ? 1 : 0;
}

/**
 * **Alto mínimo del contenido para que el header SIEMPRE pueda colapsar** (PO 2026-09-13).
 * En pestañas con poco contenido el scroll no llegaba al recorrido de colapso y el header
 * quedaba a medias. Con este mínimo (alto VISIBLE del ScrollView + recorrido) se puede subir
 * exactamente hasta colapsarlo y ni un punto más.
 *
 * T-135 (PO 2026-09-14): antes se usaba el alto de la VENTANA, que es mayor que el del
 * ScrollView (le restan notch, barra y tab bar): esa diferencia era scroll de sobra y el
 * contenido corto se podía ir entero hacia arriba. Sin medir todavía (0) no fuerza nada.
 */
export function altoMinimoContenido(altoVisible: number, recorrido: number): number {
  return altoVisible > 0 ? altoVisible + recorrido : 0;
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
): {
  scrollHandler: ReturnType<typeof useAnimatedScrollHandler>;
  progress: SharedValue<number>;
  /** Para `contentContainerStyle`: garantiza que el header pueda colapsar con poco contenido. */
  contenidoMinimo: { minHeight: number };
  /** Para el `onLayout` del ScrollView: mide su alto visible real. */
  alMedirScroll: (e: LayoutChangeEvent) => void;
} {
  // 1:1 con lo que pierde el header (T-131): así su borde inferior sigue exacto al contenido.
  // Skin Aero: el recorrido es el de su tarjeta de título (ver `RECORRIDO_AERO`).
  const soft = useSkinTokens().flags.soft;
  const distancia = options.distanciaColapso ?? (soft ? RECORRIDO_AERO : TITLE_BLOCK_H);
  const progress = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      progress.value = progresoColapso(event.contentOffset.y, distancia, 0);
    },
  });

  // DIAG (PO 2026-09-23): semilla inicial desde useWindowDimensions en vez de
  // 0 — hipótesis: el salto de minHeight 0→real tras el primer onLayout no
  // reflowa bien el ScrollView con stickyHeaderIndices en el primer render.
  const { height: altoVentana } = useWindowDimensions();
  const [altoVisible, setAltoVisible] = useState(altoVentana);
  const alMedirScroll = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setAltoVisible((prev) => (prev === h ? prev : h));
  }, []);
  return {
    scrollHandler, progress, alMedirScroll,
    contenidoMinimo: { minHeight: altoMinimoContenido(altoVisible, distancia) },
  };
}
