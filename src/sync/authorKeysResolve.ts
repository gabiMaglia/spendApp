import { knownAuthorKeys, ES_PUBLICA } from './authorKeysCache';

/**
 * S4 · resolución del autor, fuera de banda — salió de `authorKeys.ts`
 * (T-192).
 *
 * **Las tres fuentes se consultan como UNIÓN, nunca como cadena** (§2 del plan).
 *
 * La razón no es estética. `savePeerFromCard` sólo completa huecos y nunca
 * reemplaza una clave que ya teníamos (`contactChannel.ts:432-444`, y es
 * deliberado: si pudiera pisarlas, cualquiera que conozca el buzón mandaría una
 * tarjeta diciendo ser otro). Consecuencia: quien reinstala la app queda para
 * siempre con su clave VIEJA en nuestro registro local. Una cadena que
 * preguntara primero ahí y se conformara con esa respuesta marcaría como
 * `invalida` todo lo que esa persona escriba de ahora en más. La unión lo salva
 * por el directorio, que sí tiene la clave nueva.
 *
 * Las fuentes, y de dónde sale cada una en el camino SÍNCRONO:
 *
 *  1. **Registro local de peers** — `getPeer(autor).identityPublicKey`
 *     (`contactChannel.ts:504-506`). Offline y la más fuerte: llegó por un QR.
 *  2. **Directorio por cuenta** — `fetchAccountKeys` (`deviceKeys.ts:79`, RPC
 *     `account_keys`). Es de red, así que **acá no se consulta**: se consulta
 *     fuera de banda y sus respuestas aterrizan en la fuente 3.
 *  3. **Caché de públicas ya resueltas** — `knownAuthorKeys` (`authorKeysCache.ts`).
 *
 * **Lo que NO hace, y es la mitad del valor:** no acepta una clave por el sólo
 * hecho de que un registro verifique contra sí mismo. Eso dejaría que el primer
 * registro de un autor desconocido —que puede ser el del atacante— siembre su
 * propia clave. Un autor sin claves resueltas produce `no_verificable`, que por
 * decisión del PO (R1) jamás es un rechazo ni una acusación.
 *
 * Límite heredado que conviene tener escrito: la fuente 1 también la puede
 * completar una tarjeta que llegó por el relay, no sólo un QR presencial. No
 * puede PISAR nada, pero para un autor que nunca escaneamos puede sembrar la
 * primera clave. Es el modelo de confianza que ya gobierna la entrega de claves
 * de grupo; T-041 lo hereda, no lo empeora.
 */

/** Sólo lo que se usa de cada módulo: el resto no se carga ni se tipa. */
type ModuloPeers = { getPeer(userId: string): { identityPublicKey?: string } | undefined };
type ModuloDirectorio = { fetchAccountKeys(accountId: string): Promise<string[]> };

/**
 * Los dos módulos se cargan PEREZOSAMENTE y memoizados.
 *
 * `contactChannel` arrastra `expo-crypto`, que es nativo. Este archivo lo
 * importa el merge, o sea el camino del sync: un import arriba de todo lo
 * volvería inutilizable en un build que no traiga ese binario, y eso no falla
 * en la pantalla — falla en el arranque. Ya pasó acá, y es lo que
 * `hexBytes.ts` documenta. Con la carga perezosa, la ausencia se lleva UNA
 * fuente y la unión sigue resolviendo con las otras.
 */
let modPeers: ModuloPeers | null | undefined;
let modDirectorio: ModuloDirectorio | null | undefined;

function cargarPeers(): ModuloPeers | null {
  if (modPeers !== undefined) return modPeers;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    modPeers = require('./contactChannel') as ModuloPeers;
  } catch {
    modPeers = null;
  }
  return modPeers;
}

/** Exportado: `authorKeysRefresh.ts` también lo necesita (para `fetchAccountKeys`). */
export function cargarDirectorio(): ModuloDirectorio | null {
  if (modDirectorio !== undefined) return modDirectorio;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    modDirectorio = require('./deviceKeys') as ModuloDirectorio;
  } catch {
    modDirectorio = null;
  }
  return modDirectorio;
}

/** Fuente 1. Nunca tira: una fuente rota vale menos que la resolución entera. */
function claveDelPeer(authorId: string): string | null {
  const mod = cargarPeers();
  if (!mod) return null;
  try {
    const k = mod.getPeer(authorId)?.identityPublicKey;
    return k && ES_PUBLICA.test(k) ? k : null;
  } catch {
    return null;
  }
}

/**
 * Las públicas con las que puede haber firmado este autor. **Síncrona y sin
 * red**: es lo que va a llamar el merge, y `applyDelta` es síncrono (§3).
 *
 * Se recorren TODAS las fuentes. Ninguna corta a la siguiente, ni siquiera
 * cuando contesta. **La propia NO es una de estas fuentes** (ver el
 * comentario de `clavePropia`, `authorKeysRefresh.ts`): mezclarla acá
 * contaminaría a TODO consumidor de esta función —`checkSettlement`,
 * `recordHealth.observeRecord`, `applyLeave`— que nunca pidió el fix de D-2 y
 * no lo necesita.
 */
export function resolveAuthorKeys(authorId: string): readonly string[] {
  if (!authorId) return [];

  const union: string[] = [];
  const sumar = (k: string | null | undefined) => {
    if (k && !union.includes(k)) union.push(k);
  };

  sumar(claveDelPeer(authorId));
  for (const k of knownAuthorKeys(authorId)) sumar(k);

  return union;
}

/** Suelta los módulos cargados perezosamente. Sólo tests. */
export function __resetAuthorResolveSources(): void {
  modPeers = undefined;
  modDirectorio = undefined;
}
