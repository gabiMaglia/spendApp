/**
 * T-157b: cede el event loop entre piezas de trabajo pesado (sellar/firmar un
 * sobre, abrir/descifrar uno recibido). Con ADR-007 una publicación o un
 * drenaje puede procesar decenas de rebanadas seguidas — cada una con su
 * propio cifrado/firma — todo en una sola vuelta síncrona de JS. En un
 * dispositivo de gama baja eso alcanza a trabar la UI el tiempo que tarda la
 * ráfaga entera. Un `setTimeout(0)` entre piezas le da al event loop la
 * chance de atender lo que esté esperando (un tap, un render) sin cambiar el
 * resultado final: el orden y el contenido de lo que se manda o se aplica no
 * dependen de CUÁNDO corre cada `await`, sólo de en qué orden corre.
 */
export const cederHilo = (): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, 0));
