/**
 * Clasificación de errores del relay + utilidades compartidas por
 * `sendEnvelope` (`relaySend.ts`) y `fetchSince` (`relay.ts`) — T-192, salió
 * de `relay.ts` para bajarlo de 509 líneas. Sin cliente de Supabase: nada
 * acá toca la red, sólo clasifica lo que ya volvió.
 */

/** Cada cuánto se reintenta la RPC aunque el flag de "no existe" esté prendido.
 *  Generoso a propósito: es una migración rara, no un fallo de red — no hace
 *  falta probar cada pocos segundos. */
export const RPC_REINTENTO_MS = 5 * 60_000;

export function tocaReintentar(momento: number): boolean {
  return momento !== 0 && Date.now() - momento >= RPC_REINTENTO_MS;
}

/**
 * ¿Este error es "la función no existe en este proyecto"? — la RPC todavía no
 * se corrió (011a pendiente), no un fallo transitorio. `PGRST202` es el código
 * de PostgREST; `42883` el de Postgres directo; el texto es la red de
 * seguridad para versiones que no mandan ninguno de los dos.
 */
export function esFuncionAusente(e: { code?: string; message: string }): boolean {
  return e.code === 'PGRST202' || e.code === '42883'
    || /could not find the function/i.test(e.message)
    || /function .*does not exist/i.test(e.message);
}

/**
 * ¿Este error es el freno de la cuota (T-147 D3)? `PT429` es el código propio
 * que usa `relay_enforce_quota`; el texto es la red de seguridad si PostgREST
 * no llega a mapearlo. **No es un error de red**: reintentar en el momento
 * sólo empeora, por eso no cae a ningún fallback (H6).
 */
export function esLimiteDeRitmo(e: { code?: string; message: string }): boolean {
  return e.code === 'PT429' || /relay_quota_exceeded/i.test(e.message);
}

export function byteLength(s: string): number {
  // `length` cuenta unidades UTF-16: con acentos o emoji miente respecto de los
  // bytes que viajan, que es lo que el servidor limita.
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}
