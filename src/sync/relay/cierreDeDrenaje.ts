/**
 * Núcleo PURO del cierre de `drainGroup` (T-192, Task 3 — frontera P15: sin
 * stores, sin red, sin `await`). Extraído de `relaySync.ts` para poder
 * probar con tablas de casos el cálculo del cursor y qué queda "retenido"
 * (spec §8 C2, ADR-007 §T-191).
 */

/** Una rebanada que se aplicó pero quedó con descartes por dependencia. */
export type Retenida = { seq: number; ckey?: string; sender: string };

export type ResultadoCierre = { cursor: number; completo: boolean };

/**
 * El cursor NUNCA pasa una retenida por dependencia que siga sin resolver Y
 * con cupo: si `H` no está vacío, se recorta a justo ANTES de la más vieja de
 * ellas, para que la próxima vuelta la vuelva a pedir. Invariante que
 * garantiza el llamador (nunca se verifica acá): la retenida más vieja de
 * `H` nunca es anterior a `sinceSeq`, porque `H` sólo contiene rebanadas que
 * este mismo drenaje leyó — por eso `cursorFinal(base, H) >= sinceSeq`
 * siempre que `base >= sinceSeq`.
 */
export function cursorFinal(base: number, H: Retenida[]): number {
  if (H.length === 0) return base;
  const minSeq = Math.min(...H.map(h => h.seq));
  return Math.min(base, minSeq - 1);
}

/** `completo` original se apaga si queda algo sin resolver en `H`. */
export function completoFinal(completo: boolean, H: Retenida[]): boolean {
  return completo && H.length === 0;
}

/**
 * Separa las retenidas por dependencia en `H` (siguen pendientes Y con cupo
 * — bloquean el cursor) y `noResueltas` (siguen pendientes, con o sin cupo —
 * dejan de contar como "cumplidas" para el manifiesto). Una retenida sin
 * cupo sale de `H` pero se queda en `noResueltas`: no bloquea el cursor,
 * pero el manifiesto la sigue marcando faltante.
 */
export function clasificarRetenidas(
  resultados: { retenida: Retenida; siguePendiente: boolean; agotada: boolean }[],
): { H: Retenida[]; noResueltas: Retenida[] } {
  const H: Retenida[] = [];
  const noResueltas: Retenida[] = [];
  for (const { retenida, siguePendiente, agotada } of resultados) {
    if (!siguePendiente) continue;
    noResueltas.push(retenida);
    if (!agotada) H.push(retenida);
  }
  return { H, noResueltas };
}

/**
 * Una retenida NO RESUELTA se saca de `recibidas` ANTES del chequeo de
 * manifiesto: `entradaCumplida` la daría por cumplida sólo porque el sobre
 * LLEGÓ, sin mirar si de verdad terminó de aplicarse.
 */
export function quitarNoResueltas(
  recibidas: Map<string, Map<string, string>>,
  noResueltas: Retenida[],
): void {
  for (const { sender, ckey } of noResueltas) {
    if (ckey) recibidas.get(sender)?.delete(ckey);
  }
}

/**
 * Una ckey retenida sin resolver NO dispara relectura: el sobre ya está en
 * mano, releerlo de nuevo no cambia nada (el problema es la dependencia, no
 * el transporte). `true` sólo si HAY faltantes y TODOS son retenidas
 * conocidas de este sender.
 */
export function faltantesSoloRetenidas(
  faltantes: { ckey: string }[],
  noResueltasDelSender: Set<string>,
): boolean {
  return faltantes.length > 0 && faltantes.every(f => noResueltasDelSender.has(f.ckey));
}
