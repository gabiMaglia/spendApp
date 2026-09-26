/**
 * **Geometría del header Aero** (PO 2026-09-26): dos tarjetas con margen a
 * los costados — la barra (fija, nunca cambia de alto ni de lugar) y la del
 * título, debajo. Al scrollear:
 *
 *  1. `p ∈ [0, FUSION]`: el aire entre las dos se cierra y las esquinas que
 *     se enfrentan se aplanan → se leen como una sola tarjeta;
 *  2. `p ∈ [FUSION, 1]`: la parte del título se achica hasta 0;
 *  3. `p ∈ [REAPARECE, 1]`: la barra recupera sus esquinas de abajo, así
 *     colapsada queda redondeada como al principio.
 *
 * Funciones puras (`worklet`) para poder testearlas sin Reanimated.
 */

import { TITLE_BLOCK_H } from '@/src/constants/header';

/**
 * Alto de la tarjeta del título (y recorrido del colapso) en el Aero: 3/4 del
 * bloque título del header de siempre (PO 2026-09-26: «1/4 menos»).
 */
export const TITULO_AERO_H = Math.round(TITLE_BLOCK_H * 0.75);

/** Aire entre la status bar y la barra. */
export const AERO_TOPE = 6;
/** Aire entre la barra y la tarjeta del título (expandido). */
export const AERO_AIRE = 16;
/** Radio pronunciado de las dos tarjetas. */
export const AERO_RADIO = 24;
/**
 * Recorrido del colapso en el Aero: alto del título + el aire que se cierra.
 * Es exactamente lo que baja el borde inferior de la tarjeta del título, así
 * que ese borde acompaña al contenido 1:1 (PO 2026-09-26: sin «fondo fantasma»).
 */
export const RECORRIDO_AERO = TITULO_AERO_H + AERO_AIRE;
/** Fin de la fase de fusión. */
export const FUSION = 0.35;
/** Desde acá la barra vuelve a redondear sus esquinas de abajo. */
export const REAPARECE = 0.9;

function clamp01(v: number): number {
  'worklet';
  return Math.min(1, Math.max(0, v));
}

/** Aire actual entre barra y título: de `AERO_AIRE` a 0 durante la fusión. */
export function aireEntreTarjetas(p: number): number {
  'worklet';
  return AERO_AIRE * (1 - clamp01(p / FUSION));
}

/** Radio de las esquinas enfrentadas (abajo de la barra y arriba del título) durante la fusión. */
export function radioEnfrentado(p: number): number {
  'worklet';
  return AERO_RADIO * (1 - clamp01(p / FUSION));
}

/** Radio de abajo de la barra: se aplana al fusionarse y vuelve cuando el título ya casi no está. */
export function radioInferiorBarra(p: number): number {
  'worklet';
  const q = clamp01(p);
  if (q <= FUSION) return radioEnfrentado(q);
  if (q < REAPARECE) return 0;
  return AERO_RADIO * clamp01((q - REAPARECE) / (1 - REAPARECE));
}

/**
 * Alto de la tarjeta del título. Su borde de abajo acompaña al contenido
 * (recorre `recorrido + AERO_AIRE` en todo el colapso, apenas más que el
 * contenido, así nunca se le mete debajo) y su borde de arriba sube con el
 * aire que se cierra.
 */
export function altoTarjetaTitulo(p: number, recorrido: number): number {
  'worklet';
  const q = clamp01(p);
  const abajo = (recorrido + AERO_AIRE) * (1 - q);
  return Math.max(0, abajo - aireEntreTarjetas(q));
}

/** Si la barra y el título ya están unidos: sin borde en la costura (no se ve doble). */
export function unidas(p: number): boolean {
  'worklet';
  const q = clamp01(p);
  return q >= FUSION && q < REAPARECE;
}
