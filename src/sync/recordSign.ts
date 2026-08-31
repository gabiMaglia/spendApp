import { ed25519 } from '@noble/curves/ed25519.js';
import { canonicalCore, type CoreKind, type CoreRecord } from './recordCore';
import { toHex, fromHex, utf8Bytes } from './hexBytes';

/**
 * **Firmar y verificar el núcleo de un registro** (T-041 · S2).
 *
 * La firma del sobre (T-033) prueba quién publicó el sobre; ésta prueba quién
 * declaró el registro. Son ejes ortogonales: el sobre lleva el estado completo
 * del grupo y lo republica cualquier miembro, así que el que manda el sobre casi
 * nunca es el autor de lo que va adentro.
 *
 * La firma viaja ADENTRO del registro (`k` + `s`), así que se verifica sin
 * saber nada de quién lo trajo. Es la propiedad que hace que esto sirva contra
 * un miembro malicioso, que es exactamente lo que `envelopeSign.ts:20-23` dice
 * que él no puede hacer.
 *
 * **Esto no rechaza nada.** Devuelve un veredicto. Qué se hace con él lo decide
 * el llamador, y la decisión del PO (R1) es: se muestra, suma al balance, y se
 * marca. T-041 no impide la suplantación — la vuelve visible y atribuible.
 */

export type CoreVerdict =
  /** Firma presente, verifica, y la pública es de quien el registro dice ser. */
  | 'valida'
  /** Hay firma y no cierra: no verifica, o verifica con una clave ajena al autor. */
  | 'invalida'
  /** No se puede saber. **No es una sospecha, es falta de información.** */
  | 'no_verificable';

export type CoreSignature = { k: string; s: string };

/**
 * Firma el núcleo con la privada del dispositivo (`ensureIdentity()`).
 *
 * El `record` ya tiene que traer su `rev` final: `rev` va adentro de la firma, y
 * subirlo después obliga a re-firmar. Es justamente lo que impide que un tercero
 * re-estampe un núcleo viejo para ganar el merge.
 */
export function signCore<K extends CoreKind>(
  kind: K, record: CoreRecord[K], privateKeyHex: string,
): CoreSignature {
  const priv = fromHex(privateKeyHex);
  return {
    k: toHex(ed25519.getPublicKey(priv)),
    s: toHex(ed25519.sign(utf8Bytes(canonicalCore(kind, record)), priv)),
  };
}

/**
 * El veredicto del núcleo de un registro.
 *
 * `authorKeys` son las públicas que YA sabemos que son de quien el registro
 * dice ser. Es un parámetro y no una consulta adentro a propósito: esto se llama
 * desde el merge, y `applyDelta` es síncrono — no puede haber red acá. De dónde
 * salen esas claves (unión del registro local de peers, el directorio por cuenta
 * y la caché local) es S4; la caché es `authorKeys.ts`.
 *
 * **El orden es el del sobre: descartar barato antes de tocar la criptografía
 * cara** (`envelopeSign.ts:12-13`). Verificar cuesta ~4 ms por registro medidos
 * en una laptop (§C.9 del plan), así que los tres primeros pasos son
 * comparaciones de strings y sólo el último toca la curva.
 */
export function verifyCore<K extends CoreKind>(
  kind: K, record: CoreRecord[K], authorKeys: readonly string[],
): CoreVerdict {
  const { k, s } = record as { k?: string; s?: string };

  // Sin firma no hay nada que verificar. Un registro anterior a T-041, o de un
  // peer que no actualizó, cae acá — y eso NO es una acusación.
  if (!k || !s) return 'no_verificable';

  /**
   * Autor irresoluble. Pasa de verdad y por una limitación nuestra: el borde de
   * ADR-004 (Apple manda `email` sólo en la primera autorización) deja gente
   * legítima sin clave en el directorio. Gastar la curva acá no informaría nada
   * —no vamos a poder atribuir la firma igual— y devolver `valida` sería mentir:
   * `valida` significa que la pública resuelve al `createdById` declarado.
   */
  if (authorKeys.length === 0) return 'no_verificable';

  // Firmó una clave que no es de este autor. Es la señal, y sale gratis.
  if (!authorKeys.includes(k)) return 'invalida';

  try {
    const ok = ed25519.verify(
      fromHex(s), utf8Bytes(canonicalCore(kind, record)), fromHex(k),
      /**
       * `zip215: false` — el modo estricto, no el default del paquete.
       *
       * El README de @noble/curves 2.3.0 lo justifica en dos líneas que para un
       * libro contable no son un detalle: "prevents a signer from later claiming
       * they signed a different document" y "avoids signatures valid for
       * multiple transactions (e.g., amount X also validating amount Y)".
       *
       * En el código del paquete la diferencia es concreta
       * (`abstract/edwards.js`): el modo estricto rechaza encodings no canónicos
       * y públicas de orden chico (`if (!zip215 && A.isSmallOrder()) return
       * false`). Con una pública de torsión y `s = 0` la ecuación cofactorizada
       * se cumple para CUALQUIER mensaje: una sola firma valdría para todos los
       * montos. `recordSign.test.ts` construye ese vector y exige que acá dé
       * `invalida`.
       *
       * Medido: no cuesta nada (3,914 vs 3,871 ms/op). La elección es gratis.
       */
      { zip215: false },
    );
    return ok ? 'valida' : 'invalida';
  } catch {
    // Hex inválido, largo equivocado, punto imposible. Hay firma y no cierra.
    return 'invalida';
  }
}
