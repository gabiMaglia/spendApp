import * as Crypto from 'expo-crypto';
import { fromHex } from '@/src/sync/nucleo/hexBytes';

/**
 * Derivación del topic y la clave del buzón de contacto (T-192: salió de
 * `contactChannel.ts` para que `contactGroupKeyDrop.ts` pueda importarla sin
 * crear un ciclo con `contactChannel.ts`, que a su vez re-exporta símbolos
 * de `contactGroupKeyDrop.ts`).
 */

const TOPIC_DOMAIN = 'splitp2p/contact/v1/topic';
const KEY_DOMAIN   = 'splitp2p/contact/v1';

/** Buzón de contacto de alguien, derivado de su secreto. */
export async function deriveContactTopic(secret: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${TOPIC_DOMAIN}:${secret}`);
}

/**
 * Clave que cifra lo que se deja en ese buzón.
 *
 * Dominio DISTINTO del topic a propósito: el topic viaja en claro hasta el
 * servidor, así que si los dos salieran de la misma derivación el servidor
 * tendría la clave y podría leer quién agrega a quién.
 */
export async function contactKey(secret: string): Promise<Uint8Array> {
  const hex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${KEY_DOMAIN}:${secret}`,
  );
  return fromHex(hex.slice(0, 64));
}
