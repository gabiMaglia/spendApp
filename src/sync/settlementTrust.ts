import { verifySettlement } from './settlementSign';
import { canonicalSettlement } from './settlementCore';
import { authorKeysFor } from './authorKeys';
import type { CoreVerdict } from './recordSign';
import type { SettlementConfirmation } from '@/src/types/models';

/**
 * **El veredicto de un acuse de recibo, para DECIDIR** (T-145, SEC-04).
 *
 * `verifySettlement` existía desde T-064, estaba testeado… y no lo llamaba
 * nadie en producción: `estadoDelSaldado` tomaba el acuse por `userId ===
 * toUserId` y listo. Quien declara el pago podía escribir él mismo el acuse
 * de la otra persona y cerrar la deuda solo — exactamente lo que T-064 vino a
 * impedir.
 *
 * Es el gemelo de `checkVote` (`trustCheck.ts`) con una caché en memoria,
 * porque a diferencia de la marca de una fila esto lo consulta el derivador
 * de balances en cada render: 18 ms por acuse en el teléfono del PO. La caché
 * va por **mensaje canónico + k + s** (nunca por id del pago): cualquier
 * cambio en lo firmado es otra clave. Sólo se recuerdan `valida`/`invalida`;
 * `no_verificable` es falta de información y cambia sola cuando llega la
 * clave (`authorKeysFor` ya encola la consulta al directorio).
 *
 * En memoria y no en `verdictCache` (que persiste): los acuses vigentes de un
 * dispositivo son pocos —sólo pagos pendientes en grupos `consensus`— y no
 * vale un `writeScoped` por cada uno.
 */
const cache = new Map<string, Extract<CoreVerdict, 'valida' | 'invalida'>>();

export function checkSettlement(paymentId: string, c: SettlementConfirmation): CoreVerdict {
  const { k, s } = c;
  if (!k || !s) return 'no_verificable';

  const clave = `${canonicalSettlement(paymentId, c)}|${k}|${s}`;
  const hit = cache.get(clave);
  if (hit) return hit;

  const veredicto = verifySettlement(paymentId, c, authorKeysFor(c.userId, k));
  if (veredicto !== 'no_verificable') cache.set(clave, veredicto);
  return veredicto;
}

/** Sólo tests, logout y wipe. */
export function __resetSettlementTrust(): void {
  cache.clear();
}
