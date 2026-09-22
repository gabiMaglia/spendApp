/**
 * Corta una promesa que nunca se resuelve (T-138-bis).
 *
 * Toda la cadena de arranque de sync (`doStartRelay`) es secuencial: un
 * `await` que se cuelga para siempre —un pedido de red que ni resuelve ni
 * rechaza— deja el resto de la cadena sin arrancar NUNCA, incluido el
 * polling que reintentaría solo. Un `try/catch` no alcanza para esto: no
 * hay excepción, la promesa simplemente no se resuelve. Esto sí, con una
 * carrera contra un timer.
 *
 * No cancela la promesa original (JS no tiene forma de hacerlo) — sólo deja
 * de esperarla y sigue. Si esa promesa resuelve después, su resultado se
 * pierde en silencio, que es preferible a bloquear todo para siempre.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let liquidada = false;
    const timer = setTimeout(() => {
      if (liquidada) return;
      liquidada = true;
      resolve(fallback);
    }, ms);

    promise.then(
      (v) => {
        if (liquidada) return;
        liquidada = true;
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        if (liquidada) return;
        liquidada = true;
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
