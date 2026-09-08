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
 *
 * ---
 *
 * ⚠️ **Tres de estas funciones son WORKLETS, y la directiva no es decorativa.**
 *
 * `AvatarCropSheet` las llama desde `onUpdate` de un gesto, que corre en el
 * **hilo de UI**. Una función importada de otro módulo sin `'worklet'` no existe
 * en ese runtime: Reanimated tira *«Tried to synchronously call a non-worklet
 * function on the UI thread»* (`react-native-worklets/lib/module/valueUnpacker.js:47`)
 * y **la app se cae**, en iOS y en Android por igual.
 *
 * El síntoma es preciso y vale recordarlo: **tocar y soltar no rompía nada**
 * —el `onBegin` sólo toca shared values— pero **arrastrar o pellizcar sí**,
 * porque ahí recién entra `onUpdate`. Si alguien saca una directiva, el crash
 * vuelve y ningún test de Node lo nota: en Jest son funciones normales.
 * Por eso hay un guard: `__tests__/avatarCropWorklets.test.ts`.
 *
 * `recorteDelVisor` **no** es worklet a propósito: corre en el hilo de JS al
 * confirmar, y arrastraría `medidasUtiles` con su `filter` al runtime de UI sin
 * necesidad.
 */

export type Medidas = { width: number; height: number };

export type Recorte = { originX: number; originY: number; width: number; height: number };

/**
 * La escala a la que la imagen recién cubre el visor. Es el piso del zoom:
 * por debajo quedarían bordes vacíos.
 */
export function escalaParaCubrir(img: Medidas, lado: number): number {
  'worklet';
  /**
   * ⚠️ **`Number.isFinite` y no sólo `<= 0`**, porque `NaN <= 0` es **false** y
   * un `NaN` se colaba entero por este guard. Aguas abajo eso no da un recorte
   * feo: da un `width`/`height`/`transform` en `NaN`, y **un valor no finito en
   * un estilo de layout tumba la app en iOS**. El síntoma es el que se vio —
   * recuadro vacío y crash al tocarlo— y no deja ni un error en JS.
   *
   * Devolver 1 es el mismo degradado que ya tenía: se dibuja sin escalar en vez
   * de romperse.
   */
  if (!Number.isFinite(img.width) || !Number.isFinite(img.height)) return 1;
  if (!Number.isFinite(lado) || lado <= 0) return 1;
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
  'worklet';
  /**
   * ⚠️ **No alcanza con que `escalaParaCubrir` esté acotada.** Con
   * `img.width = Infinity` la escala vuelve 1 y aun así `img.width * s - lado`
   * es `Infinity`; con `NaN`, `NaN`. Y de acá sale el límite que `acotar` le
   * aplica a `tx`/`ty`, que terminan en un `transform` — o sea el mismo crash de
   * iOS por la otra puerta. Lo encontró el test de propiedad, no una revisión.
   */
  const s = escalaParaCubrir(img, lado) * (Number.isFinite(zoom) ? zoom : 1);

  // Sin función anidada: es un worklet en el camino caliente del gesto, y una
  // closure de más ahí es una indirección que no compra nada.
  const vx = (img.width * s - lado) / 2;
  const vy = (img.height * s - lado) / 2;

  return {
    x: Number.isFinite(vx) ? Math.max(0, vx) : 0,
    y: Number.isFinite(vy) ? Math.max(0, vy) : 0,
  };
}

/** Encierra un valor entre dos límites. */
export function acotar(v: number, min: number, max: number): number {
  'worklet';
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
  /**
   * **El saneo final, que NO es defensa redundante.**
   *
   * El razonamiento de arriba —«el origen cae en `[0, ancho − lado]` por
   * construcción»— es cierto **para medidas válidas**, y ése era todo el
   * problema: con `img.width` en `0`, `NaN` o `Infinity` el origen sale negativo
   * o no finito, y el propio docblock de esta función dice qué pasa entonces —
   * *«`expo-image-manipulator` con un origen negativo no falla: recorta
   * cualquier cosa»*. Además estos números llegan a un `transform` de iOS, donde
   * un `NaN` **tumba la app**.
   *
   * Para toda entrada válida esto es un no-op: los valores ya cumplen el rango.
   */
  const ladoFinal = Number.isFinite(ladoRecorte) && ladoRecorte > 0
    ? Math.round(Math.min(ladoRecorte, ...medidasUtiles(img)))
    : 1;

  const origen = (v: number, medida: number): number => {
    if (!Number.isFinite(v)) return 0;
    const tope = Number.isFinite(medida) ? Math.max(0, medida - ladoFinal) : 0;
    return Math.min(Math.max(0, Math.round(v)), tope);
  };

  return {
    // Enteros: `expo-image-manipulator` trabaja en píxeles, y un decimal se
    // redondea distinto en cada plataforma.
    originX: origen((img.width  - ladoRecorte) / 2 - dx / escala, img.width),
    originY: origen((img.height - ladoRecorte) / 2 - dy / escala, img.height),
    width:   ladoFinal,
    height:  ladoFinal,
  };
}

/** Los lados de la imagen que sirven para topear el recorte. Vacío ⇒ no topea. */
function medidasUtiles(img: Medidas): number[] {
  return [img.width, img.height].filter(v => Number.isFinite(v) && v > 0);
}
