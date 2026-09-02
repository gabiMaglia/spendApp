import { ed25519 } from '@noble/curves/ed25519.js';
import { canonicalSettlement } from './settlementCore';
import { toHex, fromHex, utf8Bytes } from './hexBytes';
import type { CoreVerdict } from './recordSign';
import type { SettlementConfirmation } from '@/src/types/models';

/**
 * **Firmar y verificar UN acuse de recibo** (T-064).
 *
 * `recordSign` firma lo que declaró el autor del pago. Acá se firma el
 * enunciado de **otra persona sobre ese pago** —"yo, Beto, recibí esta plata"—,
 * y son cosas distintas: el núcleo lo escribe sólo quien paga, el acuse sólo
 * quien cobra.
 *
 * **Por qué importa que esto esté firmado y no sea un campo cualquiera:** el
 * acuse es lo único que separa un saldado real de uno inventado. Sin firma,
 * quien declara el pago puede escribir él mismo el acuse de la otra persona y
 * cerrar la deuda solo — que es exactamente lo que T-064 vino a impedir.
 *
 * **El merge no importa este archivo**, igual que con los votos: a 18 ms por
 * verificación medidos en el device del PO, verificar acuses mientras se mergea
 * volvería inusable el drenado del relay (D9 de T-041).
 */

export function signSettlement(
  paymentId: string, c: SettlementConfirmation, privateKeyHex: string,
): { k: string; s: string } {
  const priv = fromHex(privateKeyHex);
  return {
    k: toHex(ed25519.getPublicKey(priv)),
    s: toHex(ed25519.sign(utf8Bytes(canonicalSettlement(paymentId, c)), priv)),
  };
}

/**
 * El veredicto de un acuse. Mismo contrato que `verifyCore` y `verifyVote`:
 * descartar barato antes de tocar la curva, y **nunca acusar por falta de
 * información**.
 */
export function verifySettlement(
  paymentId: string, c: SettlementConfirmation, authorKeys: readonly string[],
): CoreVerdict {
  const { k, s } = c;

  // Un acuse de un peer que no actualizó. No es una acusación.
  if (!k || !s) return 'no_verificable';

  // Autor irresoluble (el borde de ADR-004, entre otros): gastar la curva no
  // informaría nada, porque no vamos a poder atribuir la firma igual.
  if (authorKeys.length === 0) return 'no_verificable';

  // Firmó una clave que no es de quien el acuse dice ser. Sale gratis.
  if (!authorKeys.includes(k)) return 'invalida';

  try {
    const ok = ed25519.verify(
      fromHex(s), utf8Bytes(canonicalSettlement(paymentId, c)), fromHex(k),
      // Ver la justificación larga en `recordSign.ts`. Acá el modo permisivo
      // sería particularmente caro: una sola firma de torsión valdría como
      // acuse de TODOS los saldados a la vez.
      { zip215: false },
    );
    return ok ? 'valida' : 'invalida';
  } catch {
    return 'invalida';
  }
}
