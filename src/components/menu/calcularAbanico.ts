import { Spacing } from '@/src/constants/spacing';
import { CUBO_TAMANO } from '@/src/components/CuboIcono';
import type { Rect } from '@/src/components/menu/tipos';

export const GAP_CUBOS = Spacing[3];
export const PASO_CUBOS = CUBO_TAMANO + GAP_CUBOS;
export const MARGEN_ABANICO = Spacing.screenPad;

export type Abanico = {
  left: number;
  top: number;
  /** Ancho disponible para cubo + etiqueta. */
  ancho: number;
  altoColumna: number;
  /** Lo que se ve de la columna: todo, o lo que cabe hasta el borde seguro. */
  alto: number;
  scrolla: boolean;
};

/**
 * Dónde cae la columna de cubos. Pura a propósito (en Jest `measureInWindow` es un
 * mock). El primer cubo ocupa EXACTAMENTE el rect del ancla; el resto baja con
 * paso fijo. Nunca se mueve el primero: si no entra, scrollea la columna.
 */
export function calcularAbanico(
  ancla: Rect,
  ventana: { width: number; height: number },
  insets: { top: number; bottom: number },
  cantidad: number,
): Abanico {
  const altoColumna = cantidad > 0 ? cantidad * CUBO_TAMANO + (cantidad - 1) * GAP_CUBOS : 0;
  const limite = ventana.height - insets.bottom - MARGEN_ABANICO;
  const libre = Math.max(0, limite - ancla.y);
  const scrolla = altoColumna > libre;
  return {
    left: ancla.x, top: ancla.y,
    ancho: Math.max(0, ventana.width - MARGEN_ABANICO - ancla.x),
    altoColumna, alto: scrolla ? libre : altoColumna, scrolla,
  };
}
