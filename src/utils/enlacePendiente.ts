import { hrefInterno } from '@/src/utils/appLink';

/**
 * **El link que llegó sin sesión, para abrirlo después del login** (PO, 2026-09-12).
 *
 * Sin sesión el guard de auth redirige al login, y el destino del link se perdía. Vive en
 * memoria y no en disco a propósito: un link viejo no debería reabrirse en otro arranque.
 */

let pendiente: string | null = null;
const consumidos = new Set<string>();

export function recordarEnlace(url: string): void {
  if (consumidos.has(url)) return;
  const href = hrefInterno(url);
  if (!href) return;
  pendiente = url;
}

/** La ruta del router del link pendiente, una sola vez. */
export function tomarEnlacePendiente(): string | null {
  if (!pendiente) return null;
  const url = pendiente;
  pendiente = null;
  consumidos.add(url);
  return hrefInterno(url);
}

/** Un link que ya se abrió con sesión: no debe volver a quedar pendiente (T-094). */
export function marcarConsumido(url: string): void {
  consumidos.add(url);
  if (pendiente === url) pendiente = null;
}

/** Cerrar sesión descarta lo pendiente: el próximo login puede ser de otra cuenta (T-094). */
export function descartarEnlacePendiente(): void {
  pendiente = null;
}

/**
 * **Clasifica una URL en el momento en que LLEGA** (T-094 · SEC M-1).
 *
 * Antes se guardaba desde un efecto que dependía de la sesión, con la URL que retenía
 * `Linking.useURL()`: al cerrar sesión el efecto corría de nuevo y re-guardaba un link
 * ya usado, y el próximo login —de cualquier cuenta— lo abría.
 */
export function procesarUrlEntrante(url: string | null, haySesion: boolean): void {
  if (!url) return;
  if (haySesion) marcarConsumido(url);
  else recordarEnlace(url);
}

/** Sólo para tests. */
export function _reiniciarEnlacePendiente(): void {
  pendiente = null;
  consumidos.clear();
}
