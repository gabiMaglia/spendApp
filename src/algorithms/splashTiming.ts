/**
 * El tiempo del splash animado.
 *
 * El pedido del PO (2026-09-04), textual: «fade in de los cubos desde la
 * esquina superior al centro, y en el momento que alcanzan la superposición
 * justa, fade in de la S que termina cuando termina el movimiento de los
 * cubos».
 *
 * Eso son dos condiciones atadas a la CURVA de la animación, no dos números
 * sueltos:
 *
 *   1. La «S» **no puede empezar** antes de que los cubos estén efectivamente
 *      en su lugar. Con salida cúbica el viaje se come el 96% del recorrido
 *      mucho antes del final, así que el instante correcto no es "el final"
 *      sino el momento en que lo que falta ya no se ve.
 *   2. La «S» **termina exactamente** cuando terminan los cubos. No antes (se
 *      vería aparecer sola) ni después (la marca quedaría a medio armar con
 *      todo lo demás quieto).
 *
 * Vive separado del componente porque una animación no se puede testear
 * mirándola, pero su tiempo sí: los tests de `splashTiming` amarran estas dos
 * condiciones a la curva. Si alguien cambia el easing y no toca `INICIO_S`, se
 * caen.
 */

/*
 * Las funciones llevan `'worklet'` para que reanimated las corra en el hilo de
 * UI: la animación se maneja ENTERA desde acá, así que los tests de este módulo
 * cubren lo que efectivamente pasa en pantalla y no una copia.
 *
 * Por eso cada una es AUTOCONTENIDA y repite el acotado en vez de compartir un
 * helper. No es descuido: al workletizar, cada función queda aislada y llamar a
 * otra del mismo módulo revienta con `acotar is not a function`. Verificado
 * ejecutándolo — con el helper compartido se caían 10 de los 11 tests.
 */

/** Cuánto dura el viaje de los cubos, en ms. */
export const DURACION_MS = 760;

/** Dónde arranca el fade de la «S», en fracción del viaje. */
export const INICIO_S = 0.68;

/** Dónde termina. Es 1 por el punto 2 de arriba: no es un número ajustable. */
export const FIN_S = 1;

/**
 * Cuánto arranca CADA cubo fuera de su lugar, en fracción del lado de la marca.
 *
 * Los dos se mueven en direcciones OPUESTAS: el petróleo entra desde
 * arriba-izquierda y el salvia desde abajo-derecha, así que la separación
 * inicial entre ellos es el doble de esto. Por eso el número es chico — el
 * pedido del PO es que arranquen «levemente alejados y se vayan juntando», no
 * que crucen la pantalla.
 */
export const DESPLAZAMIENTO = 0.2;

/** Los dos cuadrados de la marca. Cada uno entra desde su esquina. */
export type Cubo = 'petroleo' | 'salvia';

/** Los cubos terminan de aparecer mucho antes de terminar de moverse. */
export const FIN_FADE_CUBOS = 0.45;

/**
 * Salida cúbica: `1 − (1 − t)³`. Es `Easing.out(Easing.cubic)` de reanimated,
 * escrita acá para poder testearla sin montar la animación.
 */
export function avanceCubos(t: number): number {
  'worklet';
  const x = Number.isNaN(t) ? 0 : Math.min(1, Math.max(0, t));
  const resto = 1 - x;
  return 1 - resto * resto * resto;
}

/** Opacidad de la «S» en el instante `t`. */
export function opacidadS(t: number): number {
  'worklet';
  const x = Number.isNaN(t) ? 0 : Math.min(1, Math.max(0, t));
  if (x <= INICIO_S) return 0;
  if (x >= FIN_S) return 1;
  return (x - INICIO_S) / (FIN_S - INICIO_S);
}

/** Opacidad de los cubos en el instante `t`. */
export function opacidadCubos(t: number): number {
  'worklet';
  const x = Number.isNaN(t) ? 0 : Math.min(1, Math.max(0, t));
  if (x >= FIN_FADE_CUBOS) return 1;
  return x / FIN_FADE_CUBOS;
}

/**
 * Dónde está un cubo en el instante `t`, en fracción del lado de la marca.
 *
 * `0` = en su lugar definitivo. El signo dice desde qué esquina viene: el
 * petróleo termina arriba-izquierda y entra desde MÁS arriba-izquierda
 * (negativo); el salvia termina abajo-derecha y entra desde MÁS abajo-derecha
 * (positivo). Como los signos son opuestos, **se acercan uno al otro** en vez de
 * viajar juntos — que es lo que hacían antes y estaba mal.
 *
 * El mismo valor sirve para X y para Y: el movimiento es en diagonal.
 */
export function desplazamiento(cubo: Cubo, t: number): number {
  'worklet';
  const x = Number.isNaN(t) ? 0 : Math.min(1, Math.max(0, t));
  const resto = 1 - x;
  const falta = resto * resto * resto;   // lo que queda de `avanceCubos`
  const v = (cubo === 'petroleo' ? -1 : 1) * falta * DESPLAZAMIENTO;
  // `-1 * 0` da `-0`, que no es lo mismo que `0` para `Object.is`. En pantalla
  // da igual; en una función pública, devolver cero negativo es basura que
  // después alguien tiene que explicar.
  return v === 0 ? 0 : v;
}

/**
 * Cuánto del viaje FALTA en el instante `t`. 0 = ya llegaron.
 *
 * No es worklet: la animación no la usa. Existe para que los tests puedan
 * preguntar «¿ya llegaron los cubos?» sin repetir la curva.
 */
export function restanteDelViaje(t: number): number {
  return 1 - avanceCubos(t);
}
