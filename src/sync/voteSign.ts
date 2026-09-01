import { ed25519 } from '@noble/curves/ed25519.js';
import { canonicalVote } from './voteCore';
import { toHex, fromHex, utf8Bytes } from './hexBytes';
import type { CoreVerdict } from './recordSign';
import type { DeletionVote } from '@/src/types/models';

/**
 * **Firmar y verificar UN voto de borrado** (T-041 · S8).
 *
 * `recordSign.ts` firma el núcleo de un registro: lo que declaró su autor. Acá
 * se firma un **enunciado de un tercero sobre el registro de otro** — "yo,
 * Caro, objeto el borrado del gasto de Ana" —, que es una cosa distinta y no
 * puede ir en la misma firma: el núcleo lo escribe sólo el autor y los votos
 * los escribe cualquier miembro del grupo.
 *
 * Y no se firma el ARRAY. El §5 del plan lo explica en una línea: es una unión
 * de aportes de gente distinta, y una firma sobre un conjunto que crece se
 * invalida cada vez que crece. Uno por uno, romper un voto no toca los demás.
 *
 * **El merge no importa este archivo**, y no es casualidad: a 37 ms por
 * verificación medidos en el device del PO, verificar votos mientras se mergea
 * volvería inusable el drenado del relay (D9). Acá se verifica para MARCAR, que
 * es lo único que la política del PO (R1) necesita.
 */

/** Firma el enunciado del voto con la privada del dispositivo. */
export function signVote(
  expenseId: string, vote: DeletionVote, privateKeyHex: string,
): { k: string; s: string } {
  const priv = fromHex(privateKeyHex);
  return {
    k: toHex(ed25519.getPublicKey(priv)),
    s: toHex(ed25519.sign(utf8Bytes(canonicalVote(expenseId, vote)), priv)),
  };
}

/**
 * El veredicto de un voto. Mismo contrato que `verifyCore`: descartar barato
 * antes de tocar la curva, y **nunca acusar por falta de información**.
 *
 * `expenseId` es un parámetro y no un campo del voto porque el voto vive
 * adentro del gasto y repetirlo sería un dato que puede mentir. Va adentro de
 * la firma igual: sin él, la objeción a un gasto valdría para cualquier otro.
 */
export function verifyVote(
  expenseId: string, vote: DeletionVote, authorKeys: readonly string[],
): CoreVerdict {
  const { k, s } = vote;

  // Un voto anterior a S8, o de un peer que no actualizó. No es una acusación.
  if (!k || !s) return 'no_verificable';

  // Autor irresoluble (el borde de ADR-004, entre otros). Gastar la curva acá
  // no informaría nada: no vamos a poder atribuir la firma igual.
  if (authorKeys.length === 0) return 'no_verificable';

  // Firmó una clave que no es de quien el voto dice ser. Sale gratis.
  if (!authorKeys.includes(k)) return 'invalida';

  try {
    const ok = ed25519.verify(
      fromHex(s), utf8Bytes(canonicalVote(expenseId, vote)), fromHex(k),
      // Ver la justificación larga en `recordSign.ts`. Acá el agujero del modo
      // permisivo sería aún más barato de explotar: un solo voto de torsión
      // valdría como pedido y como objeción a la vez.
      { zip215: false },
    );
    return ok ? 'valida' : 'invalida';
  } catch {
    return 'invalida';
  }
}
