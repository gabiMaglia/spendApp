import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { marcarConTopic } from '@/src/sync/pendingDrain';
import {
  claveLocalVinoDeContacto, conflictoForzado, marcarAdoptada, ofertasDe, registrarOferta,
} from '@/src/sync/groupKeyOffers';
import { purgarGrupoLocalmente } from './salirDelGrupo';

/**
 * **El usuario elige la clave de un remitente** (T-136 · ADR-013).
 *
 * Es la única forma de reemplazar una clave de grupo que ya está en uso, y por
 * eso las guardas no son opcionales:
 *
 *  1. el grupo NO puede estar en conflicto FORZADO (`conflictoForzado`): ahí
 *     una clave distinta quedó afuera de la tabla porque un tope estaba
 *     lleno, así que la real puede no estar entre las ofertas visibles —
 *     elegir acá sería adoptar a ciegas exactamente lo que el atacante quiso
 *     colar;
 *  2. tiene que haber una oferta de ese remitente, y
 *  3. la clave local, si existe, tiene que haber venido de contacto
 *     (`claveLocalVinoDeContacto`). Las de `ensureKey`, QR o invitación nunca
 *     se sustituyen por acá: es lo que mantiene cerrado S3-A1.
 *
 * El orden importa: **primero se purga** la copia local del grupo. Si se
 * adoptara antes, lo que vino del topic falso se publicaría con la clave real
 * (regla #8: se publica el estado completo). Después se adopta, queda
 * pendiente de drenaje y se drena el topic real.
 *
 * No llama a `salirDelGrupo`: eso publicaría una salida en el topic del
 * atacante. Lo cargado desde que llegó la clave falsa se pierde; la
 * confirmación de la tarjeta lo dice.
 */
export async function elegirClaveDeGrupo(groupId: string, fromUserId: string): Promise<boolean> {
  // 1 · guardas
  if (conflictoForzado(groupId)) return false;
  const elegida = ofertasDe(groupId).find(o => o.fromUserId === fromUserId);
  if (!elegida) return false;
  const local = useGroupKeyStore.getState().getKey(groupId);
  if (local && !claveLocalVinoDeContacto(groupId)) return false;

  // 2 · purga (incluye `forgetKey` y `olvidarOfertas`)
  purgarGrupoLocalmente(groupId);

  // 3 · adoptar. La marca de `adoptKeys` es `void`: se espera acá para que el
  // grupo quede pendiente ANTES de cualquier publicación.
  useGroupKeyStore.getState().adoptKeys([{ groupId, key: elegida.key, epoch: elegida.epoch }]);
  await marcarConTopic([groupId]);

  // 4 · la elegida queda como única oferta, adoptada: la purga ya descartó las demás.
  registrarOferta({ ...elegida, adoptada: false });
  marcarAdoptada(groupId, fromUserId);

  // 5 · drenar el topic real. Perezoso como en `salirDelGrupo`: `relayEngine`
  // importa a los stores que esto usa.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drainNow, startRelay } = require('@/src/sync/relayEngine') as typeof import('@/src/sync/relayEngine');
    await drainNow(groupId);
    void startRelay();
  } catch {
    // Sin red: el grupo quedó pendiente y se drena en el próximo arranque.
  }
  return true;
}
