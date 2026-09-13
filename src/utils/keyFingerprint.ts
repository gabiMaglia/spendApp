/**
 * Huella corta de una clave pública, para que el usuario compare "a ojo" antes
 * de confirmar un contacto que llegó por link (T-093 / SEC H-1). Es sólo
 * presentación — no reemplaza la verificación de `hasConflictingPinnedKeys`.
 */
const BLOQUE = 4;
const LARGO = 16;

export function shortFingerprint(publicKeyHex?: string): string {
  if (!publicKeyHex) return '';
  const recorte = publicKeyHex.slice(0, LARGO);
  const bloques: string[] = [];
  for (let i = 0; i < recorte.length; i += BLOQUE) bloques.push(recorte.slice(i, i + BLOQUE));
  return bloques.join(' ');
}
