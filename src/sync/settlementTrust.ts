import { verifySettlement } from './settlementSign';
import { canonicalSettlement } from './settlementCore';
import { authorKeysFor, authorKeyWasAsked } from './authorKeys';
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
 *
 * **D2 de `authorKeys.ts`, acá también** (T-145, ronda 2 del verificador). Un
 * acreedor que reinstaló queda en nuestro registro local con su clave VIEJA:
 * `authorKeysFor` no devuelve `[]` —tiene una clave, la equivocada— así que
 * `verifySettlement` marcaría `invalida` sin poder distinguir una reinstalación
 * legítima de una suplantación. Mismo bug, mismo arreglo que `recordHealth.ts`:
 * antes de gastar la curva, si la clave presentada no está cubierta, sólo hay
 * señal de verdad cuando el directorio **ya contestó sobre ESA clave** y siguió
 * sin cubrirla (`authorKeyWasAsked`). Hasta entonces, `no_verificable` — que
 * para un `reject` se sigue honrando (regla de negocio 3: es lo único que
 * devuelve la deuda a la vida) y para un `confirm` sigue sin cerrar nada.
 *
 * `no_verificable` nunca se cachea (ver más abajo), así que esta clasificación
 * se reevalúa sola en la próxima lectura: ni aprender la clave nueva
 * (`rememberAuthorKey`) ni que el directorio conteste necesitan vaciar la
 * caché a mano.
 *
 * **Autor SIN ninguna clave, nunca** (T-145, Re-review 1). Distinto de D2: acá
 * `keys` está VACÍO, no con una clave equivocada — el borde de ADR-004, quien
 * entró por Apple sin `email` y el directorio jamás va a resolver. Sin esta
 * guarda explícita, ese autor cae en la rama de D2 y, en cuanto el directorio
 * contesta (vacío, que es lo normal para él), `authorKeyWasAsked` da `true` y
 * queda `invalida` para siempre — no hay clave que pueda aprender jamás. Mismo
 * guardia que `settlementSign.ts` ya tenía y que `recordHealth.ts` conserva.
 */
const cache = new Map<string, Extract<CoreVerdict, 'valida' | 'invalida'>>();

export function checkSettlement(paymentId: string, c: SettlementConfirmation): CoreVerdict {
  const { k, s, userId } = c;
  if (!k || !s) return 'no_verificable';

  const clave = `${canonicalSettlement(paymentId, c)}|${k}|${s}`;
  const hit = cache.get(clave);
  if (hit) return hit;

  const keys = authorKeysFor(userId, k);

  let veredicto: CoreVerdict;
  if (keys.length === 0) {
    // Autor irresoluble (borde de ADR-004): no hay ninguna clave con la que
    // comparar, ni vieja ni nueva. Gastar la curva no informaría nada, y
    // acusar acá sería acusar para siempre a alguien que el directorio nunca
    // va a poder cubrir.
    veredicto = 'no_verificable';
  } else if (keys.includes(k)) {
    veredicto = verifySettlement(paymentId, c, keys);
  } else {
    // D2: clave no cubierta (pero HAY alguna, la vieja). `invalida` sólo si el
    // directorio ya contestó sobre ESTA clave presentada; si todavía no, es
    // indistinguible de una reinstalación honesta.
    veredicto = authorKeyWasAsked(userId, k) ? 'invalida' : 'no_verificable';
  }

  if (veredicto !== 'no_verificable') cache.set(clave, veredicto);
  return veredicto;
}

/** Sólo tests, logout y wipe. */
export function __resetSettlementTrust(): void {
  cache.clear();
}
