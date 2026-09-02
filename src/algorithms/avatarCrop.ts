/**
 * **La matemática del recorte del avatar** (T-067).
 *
 * Vive separada de la pantalla porque es lo único de todo el flujo que puede
 * estar mal **en silencio**: un recorte corrido dos píxeles no rompe nada, no
 * tira ninguna excepción, y produce una foto con la cara descentrada que nadie
 * atribuye a un bug. Los gestos, en cambio, o andan o se nota enseguida.
 *
 * Convención de coordenadas, que es donde se cometen los errores:
 *
 *  - La imagen se dibuja CENTRADA en un visor cuadrado de lado `lado`.
 *  - `zoom = 1` es la escala mínima que **cubre** el visor (nunca «entrar»
 *    entero: un avatar con bordes vacíos no es un avatar).
 *  - `tx`/`ty` son el desplazamiento en píxeles de PANTALLA desde el centro.
 *  - El resultado vuelve en píxeles de la IMAGEN ORIGINAL, que es lo que
 *    espera `expo-image-manipulator`.
 */

export type Medidas = { width: number; height: number };

export type Recorte = { originX: number; originY: number; width: number; height: number };

/**
 * La escala a la que la imagen recién cubre el visor. Es el piso del zoom:
 * por debajo quedarían bordes vacíos.
 */
export function escalaParaCubrir(img: Medidas, lado: number): number {
  if (img.width <= 0 || img.height <= 0) return 1;
  return Math.max(lado / img.width, lado / img.height);
}

/**
 * Cuánto se puede arrastrar en cada eje sin descubrir un borde.
 *
 * Es cero cuando ese eje entra justo: la imagen no se mueve, y dejar que se
 * moviera mostraría vacío.
 */
export function limitesDePan(img: Medidas, lado: number, zoom: number): { x: number; y: number } {
  const s = escalaParaCubrir(img, lado) * zoom;
  return {
    x: Math.max(0, (img.width * s - lado) / 2),
    y: Math.max(0, (img.height * s - lado) / 2),
  };
}

/** Encierra un valor entre dos límites. */
export function acotar(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * El rectángulo a recortar, en píxeles de la imagen original.
 *
 * `tx`/`ty` se acotan acá y no sólo en el gesto: el gesto los acota para que se
 * sienta bien, pero **esta función no puede confiar en eso**. Un valor fuera de
 * rango produciría un `originX` negativo, y `expo-image-manipulator` con un
 * origen negativo no falla: recorta cualquier cosa.
 */
export function recorteDelVisor(
  img: Medidas, lado: number, zoom: number, tx: number, ty: number,
): Recorte {
  const escala = escalaParaCubrir(img, lado) * Math.max(1, zoom);
  const lim = limitesDePan(img, lado, Math.max(1, zoom));

  const dx = acotar(tx, -lim.x, lim.x);
  const dy = acotar(ty, -lim.y, lim.y);

  /**
   * Lado del recorte en píxeles de la imagen.
   *
   * No hace falta topearlo contra `img.width`/`img.height`: como
   * `escalaParaCubrir` es `lado / min(ancho, alto)`, `lado / escala` da
   * `min(ancho, alto) / zoom`, que nunca supera el lado corto. Había un
   * `Math.min` de más y lo delató una mutación que sobrevivió — el código
   * muerto se borra, no se le inventa un test.
   */
  const ladoRecorte = lado / escala;

  /**
   * Y por lo mismo, el origen no se vuelve a acotar acá: con `dx` ya acotado a
   * `(ancho·escala − lado) / 2`, el origen cae exactamente en `[0, ancho −
   * lado]` por construcción. Acotarlo otra vez era una defensa que ningún
   * llamador podía disparar.
   */
  return {
    // Enteros: `expo-image-manipulator` trabaja en píxeles, y un decimal se
    // redondea distinto en cada plataforma.
    originX: Math.round((img.width  - ladoRecorte) / 2 - dx / escala),
    originY: Math.round((img.height - ladoRecorte) / 2 - dy / escala),
    width:   Math.round(ladoRecorte),
    height:  Math.round(ladoRecorte),
  };
}
