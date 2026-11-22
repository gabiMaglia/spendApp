import { CUBO_TAMANO } from '@/src/components/CuboIcono';
import { MARGEN_ABANICO, PAD_CAPSULA, VISIBLES } from '@/src/components/menu/calcularAbanico';
import type { Rect } from '@/src/components/menu/tipos';

/** Cápsula vertical: cubo arriba y el nombre debajo. */
export const ANCHO_CAPSULA = CUBO_TAMANO + 2 * PAD_CAPSULA;
export const ALTO_NOMBRE = 16;
export const ALTO_CAPSULA = PAD_CAPSULA + CUBO_TAMANO + 6 + ALTO_NOMBRE + 8;
export const GAP_FILA = 12;
export const PASO_CAPSULA = ANCHO_CAPSULA + GAP_FILA;
/** Aire entre el control original y la fila. */
export const SEPARACION_FILA = 12;

export type Hilera = {
  left: number;
  top: number;
  lado: 'abajo' | 'arriba';
  /** La fila crece hacia la derecha del ancla; si no, hacia la izquierda. */
  haciaDerecha: boolean;
  /** Ancho fijo de lo que se ve: VISIBLES cápsulas (o las que entren), sin una 5ª asomando. */
  anchoVentana: number;
  anchoContenido: number;
  scrolla: boolean;
  /** Corrimiento horizontal que lleva la cápsula de su slot (sin scroll) al borde del ancla. */
  origenX: number;
  /** Corrimiento vertical que lleva la cápsula al centro del ancla. */
  desdeY: number;
};

const anchoDe = (n: number) => (n > 0 ? n * ANCHO_CAPSULA + (n - 1) * GAP_FILA : 0);

/**
 * Dónde cae la fila de cápsulas. Pura (en Jest `measureInWindow` es un mock).
 * Derecha si el centro del ancla está en la mitad izquierda, si no izquierda;
 * abajo si la fila entra antes del borde seguro, si no arriba.
 */
export function calcularFila(
  ancla: Rect,
  ventana: { width: number; height: number },
  insets: { top: number; bottom: number },
  cantidad: number,
): Hilera {
  const haciaDerecha = ancla.x + ancla.width / 2 < ventana.width / 2;
  const disponible = Math.max(0, ventana.width - 2 * MARGEN_ABANICO);
  const entran = Math.floor((disponible + GAP_FILA) / PASO_CAPSULA);
  const visibles = Math.min(cantidad, VISIBLES, Math.max(1, entran));
  const anchoVentana = anchoDe(visibles);

  const deseado = haciaDerecha ? ancla.x : ancla.x + ancla.width - anchoVentana;
  const maxLeft = Math.max(MARGEN_ABANICO, ventana.width - MARGEN_ABANICO - anchoVentana);
  const left = Math.min(Math.max(deseado, MARGEN_ABANICO), maxLeft);

  const limite = ventana.height - insets.bottom - MARGEN_ABANICO;
  const abajo = ancla.y + ancla.height + SEPARACION_FILA + ALTO_CAPSULA <= limite;
  // Arriba no puede pisar el notch/barra de estado: si no entra, queda pegada al límite.
  const topArriba = Math.max(ancla.y - SEPARACION_FILA - ALTO_CAPSULA, insets.top + MARGEN_ABANICO);
  const top = abajo ? ancla.y + ancla.height + SEPARACION_FILA : topArriba;

  const bordeAncla = haciaDerecha ? ancla.x : ancla.x + ancla.width - ANCHO_CAPSULA;
  return {
    left, top, lado: abajo ? 'abajo' : 'arriba', haciaDerecha,
    anchoVentana, anchoContenido: anchoDe(cantidad), scrolla: cantidad > visibles,
    origenX: bordeAncla - left,
    desdeY: ancla.y + ancla.height / 2 - (top + ALTO_CAPSULA / 2),
  };
}

/**
 * Dónde arranca el scroll: junto al ancla (inicio si crece a la derecha, final si a la
 * izquierda), corrido lo justo para que la opción actual no quede fuera de las visibles.
 */
export function scrollInicial(h: Hilera, indiceActual: number): number {
  const visibles = Math.round((h.anchoVentana + GAP_FILA) / PASO_CAPSULA);
  const max = Math.max(0, h.anchoContenido - h.anchoVentana);
  const fuera = indiceActual >= visibles ? (indiceActual + 1 - visibles) * PASO_CAPSULA : 0;
  const x = h.haciaDerecha ? fuera : max - fuera;
  return Math.min(max, Math.max(0, x));
}
