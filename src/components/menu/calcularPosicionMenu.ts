import { Spacing } from '@/src/constants/spacing';
import type { Posicion, Rect } from '@/src/components/menu/tipos';

export const GAP_ANCLA = Spacing[1];
export const MARGEN_PANTALLA = Spacing.screenPad;
export const ANCHO_MINIMO = 220;
export const MAX_FILAS_COMPLETAS = 5;

/**
 * Dónde cae el menú respecto del disparador. Pura a propósito: en Jest
 * `measureInWindow` es un mock, así que la geometría se prueba acá.
 * Prefiere abajo; si no entra, arriba; si no entra en ninguno, el lado con más aire.
 */
export function calcularPosicionMenu(
  ancla: Rect,
  ventana: { width: number; height: number },
  insets: { top: number; bottom: number },
  altoMenu: number,
): Posicion {
  const width = Math.min(Math.max(ancla.width, ANCHO_MINIMO), ventana.width - 2 * MARGEN_PANTALLA);
  const left = Math.min(Math.max(ancla.x, MARGEN_PANTALLA), ventana.width - MARGEN_PANTALLA - width);

  const finAncla = ancla.y + ancla.height;
  const espacioAbajo = ventana.height - insets.bottom - (finAncla + GAP_ANCLA);
  const espacioArriba = ancla.y - GAP_ANCLA - insets.top;

  let lado: Posicion['lado'];
  if (altoMenu <= espacioAbajo) lado = 'abajo';
  else if (altoMenu <= espacioArriba) lado = 'arriba';
  else lado = espacioAbajo >= espacioArriba ? 'abajo' : 'arriba';

  const espacio = lado === 'abajo' ? espacioAbajo : espacioArriba;
  const maxHeight = Math.max(0, Math.min(altoMenu, espacio));
  const top = lado === 'abajo' ? finAncla + GAP_ANCLA : ancla.y - GAP_ANCLA - maxHeight;
  return { left, top, width, maxHeight, lado };
}

/**
 * Alto que se ve del menú: hasta 5 filas completas; con más, 4 y la mitad de la
 * 5ª (la media fila insinúa que hay scroll). `total` permite medir sólo las
 * primeras 5 filas cuando hay más opciones.
 */
export function altoVisibleMenu(alturasFilas: number[], total: number = alturasFilas.length): number {
  const suma = (a: number[]) => a.reduce((s, h) => s + h, 0);
  if (total <= MAX_FILAS_COMPLETAS) return suma(alturasFilas.slice(0, total));
  const quinta = alturasFilas[MAX_FILAS_COMPLETAS - 1] ?? 0;
  return suma(alturasFilas.slice(0, MAX_FILAS_COMPLETAS - 1)) + quinta / 2;
}
