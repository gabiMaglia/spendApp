import { Spacing } from '@/src/constants/spacing';
import { CUBO_TAMANO } from '@/src/components/CuboIcono';
import type { Rect } from '@/src/components/menu/tipos';

export const GAP_CUBOS = Spacing[3];
export const MARGEN_ABANICO = Spacing.screenPad;
/** Aire entre el cubo original y la columna de cápsulas. */
export const SEPARACION_ANCLA = 16;
/** Relleno de la cápsula alrededor del cubo. */
export const PAD_CAPSULA = 6;
export const ALTO_FILA = CUBO_TAMANO + 2 * PAD_CAPSULA;
export const PASO_FILA = ALTO_FILA + GAP_CUBOS;
/** Filas que se ven a la vez; el resto, con scroll. */
export const VISIBLES = 4;

export type Abanico = {
  left: number;
  top: number;
  /** Ancho disponible para la cápsula. */
  ancho: number;
  altoColumna: number;
  /** Lo que se ve de la columna: VISIBLES filas, o las que caben hasta el borde seguro. */
  alto: number;
  scrolla: boolean;
  /** Desplazamiento horizontal que lleva la cápsula de su slot al cubo original. */
  desdeX: number;
};

const altoDe = (filas: number) => (filas > 0 ? filas * ALTO_FILA + (filas - 1) * GAP_CUBOS : 0);

/**
 * Dónde cae la columna de cápsulas. Pura a propósito (en Jest `measureInWindow` es un
 * mock). Arranca a la altura del ancla y a su derecha, así el cubo original queda
 * visible; baja con paso fijo y nunca se mueve: si no entra, scrollea la columna.
 */
export function calcularAbanico(
  ancla: Rect,
  ventana: { width: number; height: number },
  insets: { top: number; bottom: number },
  cantidad: number,
): Abanico {
  const left = ancla.x + ancla.width + SEPARACION_ANCLA;
  const limite = ventana.height - insets.bottom - MARGEN_ABANICO;
  const libre = Math.max(0, limite - ancla.y);
  const entran = Math.floor((libre + GAP_CUBOS) / PASO_FILA);
  // Aunque no entre ni una se muestra una: una columna sin alto no se puede usar.
  const visibles = Math.min(cantidad, VISIBLES, Math.max(1, entran));
  return {
    left, top: ancla.y,
    ancho: Math.max(0, ventana.width - MARGEN_ABANICO - left),
    altoColumna: altoDe(cantidad), alto: altoDe(visibles), scrolla: cantidad > visibles,
    desdeX: ancla.x - left,
  };
}
