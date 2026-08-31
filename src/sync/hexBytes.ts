/**
 * Hex y UTF-8 a mano, sin dependencias.
 *
 * Existía copiado: `toHex`/`fromHex` en `envelopeCrypto.ts` y un `utf8` privado
 * en `envelopeSign.ts`. Al aparecer un tercer usuario (`recordSign.ts`, T-041)
 * se extrae, que es la regla del proyecto al segundo repetido.
 *
 * **Este archivo no importa NADA a propósito.** `envelopeCrypto.ts` arrastra
 * `expo-crypto`, que es un módulo nativo; cualquier archivo que lo toque queda
 * inutilizable donde ese nativo no está, y el camino del sync ya se rompió una
 * vez por un import así. La firma por registro tiene que poder importarse desde
 * los stores y los algoritmos sin arrastrar nada.
 *
 * `Buffer` y `TextEncoder` no se usan porque no están garantizados en Hermes.
 */

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Bytes UTF-8 de un string, incluidos los pares subrogados (emojis). */
export function utf8Bytes(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return new Uint8Array(out);
}
