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

/** Sólo para tests. */
export function _reiniciarEnlacePendiente(): void {
  pendiente = null;
  consumidos.clear();
}
