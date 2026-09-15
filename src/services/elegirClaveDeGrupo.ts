import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { marcarConTopic, marcarPendienteDeDrenaje } from '@/src/sync/pendingDrain';
import {
  claveLocalVinoDeContacto, conflictoForzado, esOfertaDeInvitacion, ofertasDe, registrarOferta,
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
 *     se sustituyen por acá: es lo que mantiene cerrado S3-A1. Y elegir una
 *     oferta de invitación deja la clave igual de protegida (paso 4).
 *
 * El orden importa, y no sólo entre pasos grandes: **primero se purga** la
 * copia local del grupo — si se adoptara antes, lo que vino del topic falso
 * se publicaría con la clave real (regla #8: se publica el estado completo).
 * Después, la marca de pendiente-de-drenaje y la adopción de la oferta van
 * ANTES de `adoptKeys` (fix round 1, T-136): `adoptKeys` pone la clave con un
 * `set()` síncrono pero sólo DISPARA su propia marca sin esperarla, así que
 * hay una ventana real en la que un `schedulePublish` viejo (de cuando el
 * grupo tenía la clave falsa) podría publicar el payload purgado con la clave
 * REAL. Recién después se drena el topic real.
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

  // 3 · pendiente de drenaje, SINCRÓNICO y ANTES de tocar la clave (fix round 1).
  // `adoptKeys` guarda la clave con un `set()` síncrono, pero internamente
  // sólo DISPARA `marcarConTopic` (`void`, sin esperarlo) — no lo espera antes
  // de volver. Entre que la clave real queda puesta y esa marca aparece hay
  // una ventana real: un `schedulePublish` con debounce que haya quedado vivo
  // de cuando el grupo tenía la clave falsa puede disparar justo ahí, y
  // `publishNow` sellaría el payload recién purgado —casi vacío— con la clave
  // REAL, compactable como si fuera el estado real del grupo. Marcar acá,
  // antes de tocar la clave, cierra esa ventana del todo.
  marcarPendienteDeDrenaje(groupId);

  // 4 · la oferta elegida queda adoptada en una sola escritura, TAMBIÉN antes
  // de `adoptKeys` (fix round 1): si el proceso se cae entre medio, no puede
  // quedar una clave local sin ninguna oferta adoptada que la respalde —eso
  // dejaría `claveLocalVinoDeContacto` en `false` para siempre y la clave
  // local recién puesta quedaría inelegible por este camino. La purga ya
  // descartó el resto de las ofertas del grupo, así que ésta es la única que
  // queda.
  //
  // EXCEPCIÓN: si `fromUserId` es una invitación (`invite:<huella>`), NO se
  // registra nada (revisión final, D-2). La purga ya olvidó todas las ofertas
  // del grupo y la marca de conflicto forzado, así que la clave adoptada queda
  // sin oferta adoptada que la respalde: `claveLocalVinoDeContacto` da `false`
  // y una entrega de contacto posterior con otra clave se ignora sin oferta ni
  // aviso. Es lo que exige S3-A1: una clave recibida por invitación nunca
  // queda disputable por contacto, la haya elegido el usuario o no.
  if (!esOfertaDeInvitacion(fromUserId)) registrarOferta({ ...elegida, adoptada: true });

  // 5 · adoptar la clave con la época de la oferta.
  useGroupKeyStore.getState().adoptKeys([{ groupId, key: elegida.key, epoch: elegida.epoch }]);

  // 6 · `marcarConTopic` de nuevo: la marca de arriba ya cerró la ventana de
  // publicación; esto es sólo para olvidar el cursor del topic REAL (deriva
  // el topic de la clave recién adoptada) — sin eso `drainNow` pediría
  // `seq > cursor_viejo` y podría no traer nada.
  await marcarConTopic([groupId]);

  // 7 · drenar el topic real. Perezoso como en `salirDelGrupo`: `relayEngine`
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
