import { ed25519 } from '@noble/curves/ed25519.js';
import { toHex, fromHex, utf8Bytes } from './hexBytes';

/**
 * Firma de los sobres del relay (ADR-003 §2, T-033).
 *
 * El buzón es público: cualquiera que conozca el `topic` puede escribir en él.
 * No puede LEER —no tiene la clave del grupo— pero sí puede llenarlo de basura,
 * y hasta acá esa basura se descartaba recién después de intentar descifrarla,
 * una por una.
 *
 * Con la firma por fuera del cifrado, un sobre ajeno se descarta ANTES de tocar
 * la criptografía cara, y queda atado a la clave del dispositivo que lo mandó.
 *
 * **Alcance honesto de lo que esto resuelve y lo que no:**
 *
 *  - contra alguien de AFUERA: sirve poco de más, porque el cifrado ya lo
 *    frenaba. Lo que gana es descartar la basura barato, sin intentar descifrar
 *    sobre por sobre;
 *  - contra un MIEMBRO malicioso: **no lo frena**. Tiene la clave del grupo, así
 *    que puede fabricar registros a nombre de quien quiera — `createdById` y
 *    `paidById` son datos como cualquier otro. Vigilar quién manda el sobre no
 *    arregla eso; hay que firmar CADA REGISTRO con la clave de su autor (T-041);
 *  - contra un EX miembro: tampoco. Para eso hace falta rotar la clave del grupo.
 *
 * Sirve, además, como cimiento: es la pieza sobre la que se apoyan tanto el
 * firmado por registro como la revocación.
 *
 * La firma NO reemplaza al cifrado: va por afuera y sólo autentica. Quien no
 * tiene la clave del grupo sigue sin poder leer nada aunque firme perfecto.
 */

const VERSION = 1;

type Wrapper = {
  v: number;
  /** Sobre sellado (base64). Lo único que lleva datos. */
  p: string;
  /** Pública Ed25519 de quien firma. */
  k: string;
  /** Firma sobre `p`. */
  s: string;
};

/** Envuelve un sobre sellado con la firma del dispositivo. */
export function signEnvelope(sealed: string, signingPrivateKey: string): string {
  const priv = fromHex(signingPrivateKey);
  const wrapper: Wrapper = {
    v: VERSION,
    p: sealed,
    k: toHex(ed25519.getPublicKey(priv)),
    s: toHex(ed25519.sign(utf8Bytes(sealed), priv)),
  };
  return JSON.stringify(wrapper);
}

export type OpenedEnvelope = { sealed: string; senderKey: string };

/**
 * Verifica la firma y devuelve el sobre sellado.
 *
 * `null` si no se puede confiar: formato desconocido, firma que no valida, o un
 * sobre sin firmar. **Los sobres sin firma se rechazan a propósito** — aceptar
 * "por compatibilidad" los que no la traen dejaría abierta exactamente la
 * puerta que esto cierra. El costo es nulo: los sobres llevan ESTADO, así que
 * uno descartado lo reemplaza la próxima publicación.
 */
export function verifyEnvelope(raw: string): OpenedEnvelope | null {
  let wrapper: Wrapper;
  try {
    wrapper = JSON.parse(raw) as Wrapper;
  } catch {
    return null; // basura, o un sobre del formato viejo sin firma
  }

  if (wrapper?.v !== VERSION || !wrapper.p || !wrapper.k || !wrapper.s) return null;

  try {
    const ok = ed25519.verify(fromHex(wrapper.s), utf8Bytes(wrapper.p), fromHex(wrapper.k));
    return ok ? { sealed: wrapper.p, senderKey: wrapper.k } : null;
  } catch {
    return null; // hex inválido en la firma o en la clave
  }
}
