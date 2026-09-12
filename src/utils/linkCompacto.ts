import { fromHex, toHex, utf8Bytes, utf8FromBytes } from '@/src/sync/hexBytes';
import type { ContactPayload } from '@/src/utils/contactLink';
import type { GroupInvite } from '@/src/sync/groupInvite';

/**
 * # La regla de compresión de los links — formato compacto v1 (PO, 2026-09-12)
 *
 * El link de contacto medía ~354 caracteres. Un acortador de terceros (bit.ly, TinyURL)
 * queda descartado: tiene que GUARDAR la URL completa para redirigir, y el link lleva el
 * secreto de canal. Esto es lo que hacen Bitwarden Send y los links de grupo de Signal:
 * bytes empaquetados, en base64url, dentro del fragmento — que no llega a ningún servidor.
 *
 * ## El link
 *
 *     https://gabimaglia.github.io/spendApp/web/abrir#<tipo><código>
 *
 * - `<tipo>`: una letra. `c` = contacto, `g` = invitación a grupo.
 * - `<código>`: base64url (RFC 4648 §5) de los bytes de abajo, **sin relleno `=`**.
 *   Alfabeto `A–Z a–z 0–9 - _`: ningún cliente de mail lo corta.
 *
 * La página (`docs/web/abrir.html`) **no decodifica nada**: abre
 * `spendapp://contact/add?c=<código>` o `spendapp://groups/join?c=<código>`, y la app
 * decodifica acá. El decodificador existe en un solo lugar.
 *
 * ## Cómo reconstruirlo — contacto (`c`)
 *
 * | bytes | contenido |
 * |---|---|
 * | 1 | versión = `1` |
 * | 1 | flags. bits 0-1: forma del id (`0` texto, `1` UUID, `2` número). bit 2: hay secreto. bit 3: hay pública de envoltura. bit 4: hay pública de firma |
 * | id | UUID → 16 bytes · número → 1 byte de largo + el número en base 256, big-endian · texto → 1 byte de largo + UTF-8 |
 * | 32 | secreto de canal, si el bit 2 |
 * | 32 | pública X25519 de envoltura, si el bit 3 |
 * | 32 | pública Ed25519 de firma, si el bit 4 |
 * | resto | nombre, UTF-8 (no vacío) |
 *
 * **El mail no viaja.** No hace falta para agregar a nadie, y T-077 declara que no sale
 * del teléfono.
 *
 * ## Cómo reconstruirlo — invitación (`g`)
 *
 * | bytes | contenido |
 * |---|---|
 * | 1 | versión = `1` |
 * | 1 | flags. bits 0-1: forma del id de grupo (`0` texto, `1` UUID) |
 * | id | UUID → 16 bytes · texto → 1 byte de largo + UTF-8 |
 * | 32 | token |
 * | 16 | huella de quien invita |
 * | 6 | vencimiento en milisegundos, entero sin signo big-endian (alcanza hasta el año 10889) |
 * | resto | nombre del grupo, UTF-8 (puede ser vacío) |
 *
 * ## Las tres garantías
 *
 * 1. **Sin pérdida o nada.** Cada campo se valida en su forma
 *    EXACTA antes de empaquetarlo: claves y UUID en hex minúscula, números sin ceros
 *    adelante, vencimiento entero. Lo que no calza —una clave en mayúsculas, un id `0123`—
 *    devuelve `null` y el llamador usa el link largo. Con eso, lo único que puede no volver
 *    es un texto con UTF-16 roto, y por eso el codificador decodifica lo que produjo.
 *    (Hubo una comparación campo por campo además: la mutación que la sacaba sobrevivió,
 *    porque con la validación exacta ningún input la alcanza. Se borró; lo que protege el
 *    formato ante un cambio futuro son los tests de ida y vuelta de todas las formas.)
 *    Un byte de clave cambiado no da un contacto raro: da uno con el que no se puede
 *    hablar nunca.
 * 2. **Estricto al leer.** Largo que no cierra, versión desconocida, UTF-8 inválido →
 *    `null`. Nunca un contacto a medias.
 * 3. **Versionado.** Un cambio de formato es la versión `2`; la `1` se sigue leyendo.
 *
 * Por qué no más corto: las tres claves son 96 de los ~120 bytes, y no se pueden derivar
 * una de otra. Bajar de ~200 caracteres exige un servidor (código corto) o un dominio
 * propio más corto que `gabimaglia.github.io/spendApp/web`.
 */

const VERSION = 1;
const ID_TEXTO = 0, ID_UUID = 1, ID_NUMERO = 2;
const HAY_SECRETO = 1 << 2, HAY_WRAP = 1 << 3, HAY_FIRMA = 1 << 4;

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RE_NUMERO = /^[1-9][0-9]{0,76}$/;
const esHex = (s: unknown, bytes: number): s is string =>
  typeof s === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(s);

// ── base64url ────────────────────────────────────────────────────────────────

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function aBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const quedan = bytes.length - i;
    out += ALFABETO[(n >> 18) & 63] + ALFABETO[(n >> 12) & 63];
    if (quedan > 1) out += ALFABETO[(n >> 6) & 63];
    if (quedan > 2) out += ALFABETO[n & 63];
  }
  return out;
}

export function desdeBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const v = [0, 1, 2, 3].map(k => (i + k < s.length ? ALFABETO.indexOf(s[i + k]) : 0));
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    const chars = Math.min(4, s.length - i);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (chars > 2 && o < out.length) out[o++] = (n >> 8) & 255;
    if (chars > 3 && o < out.length) out[o++] = n & 255;
  }
  return out;
}

// ── piezas ───────────────────────────────────────────────────────────────────

/** Número decimal (sin ceros adelante) a base 256, sin BigInt. */
function decimalABytes(dec: string): number[] {
  let digitos = Array.from(dec, d => d.charCodeAt(0) - 48);
  const out: number[] = [];
  while (digitos.length > 0) {
    let resto = 0;
    const cociente: number[] = [];
    for (const d of digitos) {
      const acc = resto * 10 + d;
      const q = Math.floor(acc / 256);
      resto = acc % 256;
      if (cociente.length > 0 || q > 0) cociente.push(q);
    }
    out.unshift(resto);
    digitos = cociente;
  }
  return out;
}

function bytesADecimal(bytes: Uint8Array): string {
  let digitos: number[] = [0];
  for (const b of bytes) {
    let carry = b;
    for (let i = digitos.length - 1; i >= 0; i--) {
      const v = digitos[i] * 256 + carry;
      digitos[i] = v % 10;
      carry = Math.floor(v / 10);
    }
    while (carry > 0) { digitos.unshift(carry % 10); carry = Math.floor(carry / 10); }
  }
  while (digitos.length > 1 && digitos[0] === 0) digitos.shift();
  return digitos.join('');
}

/** Lector con límites: cualquier lectura fuera del buffer tira, y el decodificador da null. */
class Lector {
  private i = 0;
  constructor(private readonly b: Uint8Array) {}
  byte(): number { if (this.i >= this.b.length) throw new Error('corto'); return this.b[this.i++]; }
  bytes(n: number): Uint8Array {
    if (this.i + n > this.b.length) throw new Error('corto');
    const out = this.b.slice(this.i, this.i + n); this.i += n; return out;
  }
  resto(): Uint8Array { const out = this.b.slice(this.i); this.i = this.b.length; return out; }
}

function escribirId(out: number[], id: string, permitirNumero: boolean): number | null {
  if (RE_UUID.test(id)) {
    out.push(...fromHex(id.replace(/-/g, '')));
    return ID_UUID;
  }
  if (permitirNumero && RE_NUMERO.test(id)) {
    const b = decimalABytes(id);
    if (b.length > 255) return null;
    out.push(b.length, ...b);
    return ID_NUMERO;
  }
  const b = utf8Bytes(id);
  if (b.length === 0 || b.length > 255) return null;
  out.push(b.length, ...b);
  return ID_TEXTO;
}

function leerId(r: Lector, forma: number, permitirNumero: boolean): string {
  if (forma === ID_UUID) {
    const h = toHex(r.bytes(16));
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  if (forma === ID_NUMERO && permitirNumero) return bytesADecimal(r.bytes(r.byte()));
  if (forma === ID_TEXTO) {
    const n = r.byte();
    if (n === 0) throw new Error('id vacío');
    return utf8FromBytes(r.bytes(n));
  }
  throw new Error('forma de id desconocida');
}

// ── contacto ─────────────────────────────────────────────────────────────────

export function codificarContacto(c: ContactPayload): string | null {
  if (!c.id || !c.name) return null;
  const claves: [string | undefined, number][] = [
    [c.secret, HAY_SECRETO], [c.wrapPublicKey, HAY_WRAP], [c.identityPublicKey, HAY_FIRMA],
  ];
  if (claves.some(([v]) => v !== undefined && !esHex(v, 32))) return null;

  const cuerpo: number[] = [];
  const forma = escribirId(cuerpo, c.id, true);
  if (forma === null) return null;

  let flags = forma;
  for (const [v, bit] of claves) {
    if (v === undefined) continue;
    flags |= bit;
    cuerpo.push(...fromHex(v));
  }
  cuerpo.push(...utf8Bytes(c.name));

  const codigo = aBase64Url(Uint8Array.from([VERSION, flags, ...cuerpo]));
  // Garantía 1 del encabezado: nunca se entrega un código que no se pueda leer.
  return decodificarContacto(codigo) ? codigo : null;
}

export function decodificarContacto(codigo: string): ContactPayload | null {
  const bytes = desdeBase64Url(codigo);
  if (!bytes || bytes.length < 3) return null;
  try {
    const r = new Lector(bytes);
    if (r.byte() !== VERSION) return null;
    const flags = r.byte();
    if (flags & ~0b11111) return null;

    const id = leerId(r, flags & 0b11, true);
    const clave = (bit: number) => (flags & bit ? toHex(r.bytes(32)) : undefined);
    const secret = clave(HAY_SECRETO);
    const wrapPublicKey = clave(HAY_WRAP);
    const identityPublicKey = clave(HAY_FIRMA);
    const name = utf8FromBytes(r.resto());
    if (!name) return null;

    return {
      id, name, email: '',
      ...(secret ? { secret } : {}),
      ...(wrapPublicKey ? { wrapPublicKey } : {}),
      ...(identityPublicKey ? { identityPublicKey } : {}),
    };
  } catch {
    return null;
  }
}

// ── invitación ───────────────────────────────────────────────────────────────

const MAX_UINT48 = 2 ** 48 - 1;

export function codificarInvitacion(inv: GroupInvite): string | null {
  if (!inv.groupId || !esHex(inv.token, 32) || !esHex(inv.inviterFingerprint, 16)) return null;
  if (!Number.isInteger(inv.expiresAt) || inv.expiresAt < 0 || inv.expiresAt > MAX_UINT48) return null;

  const cuerpo: number[] = [];
  const forma = escribirId(cuerpo, inv.groupId, false);
  if (forma === null) return null;
  cuerpo.push(...fromHex(inv.token), ...fromHex(inv.inviterFingerprint));

  // 6 bytes big-endian sin operadores de bits: `<<` en JS trunca a 32 bits.
  let e = inv.expiresAt;
  const vence = new Array<number>(6);
  for (let i = 5; i >= 0; i--) { vence[i] = e % 256; e = Math.floor(e / 256); }
  cuerpo.push(...vence, ...utf8Bytes(inv.groupName ?? ''));

  const codigo = aBase64Url(Uint8Array.from([VERSION, forma, ...cuerpo]));
  // Garantía 1 del encabezado: nunca se entrega un código que no se pueda leer.
  return decodificarInvitacion(codigo) ? codigo : null;
}

export function decodificarInvitacion(codigo: string): GroupInvite | null {
  const bytes = desdeBase64Url(codigo);
  if (!bytes || bytes.length < 2 + 1 + 32 + 16 + 6) return null;
  try {
    const r = new Lector(bytes);
    if (r.byte() !== VERSION) return null;
    const flags = r.byte();
    if (flags & ~0b11) return null;

    const groupId = leerId(r, flags & 0b11, false);
    const token = toHex(r.bytes(32));
    const inviterFingerprint = toHex(r.bytes(16));
    let expiresAt = 0;
    for (const b of r.bytes(6)) expiresAt = expiresAt * 256 + b;
    const groupName = utf8FromBytes(r.resto());

    return { groupId, groupName, token, inviterFingerprint, expiresAt };
  } catch {
    return null;
  }
}
