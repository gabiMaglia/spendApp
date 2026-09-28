import { DELTA_FEATURE_VERSION, type SyncDelta } from '../applyDelta';
import { sealEnvelope, deriveTopic } from '../envelopeCrypto';
import { sendEnvelope, deleteMyEnvelopes, type DeleteResult } from '../relay';
import { groupKeyBytes, useGroupKeyStore } from '@/src/store/groupKeyStore';
import { ensureIdentity } from '@/src/store/identityStore';
import { signEnvelope } from '../envelopeSign';
import { recordError } from '@/src/services/errorLog';
import { cederHilo } from '../cederHilo';
import * as adaptador from './adaptadorHushSplit';
import { publicarPorCubos, type CampoDoc } from './publicarCubos';
import { olvidarTopic as olvidarTopicDelLedger, olvidarCubo } from './sliceLedger';

/**
 * Publicación por el relay (T-192: salió de `relaySync.ts`).
 *
 * **Por el relay NUNCA viaja una clave de grupo** — si pudiera, sustituiría
 * la propia y leería todo (ADR-003 §1). Por eso el payload se arma acá y no
 * se reusa `buildDelta` tal cual.
 */

/**
 * Payload del relay: **sólo lo del grupo al que se publica** (T-093/T-157a —
 * se filtra por `groupId` ANTES de limpiar campos, nunca al revés; ver
 * ADR-007 y `relayScopeFiltraPrimero.test.ts` para el porqué y la
 * comparación byte a byte contra la implementación vieja). Se arma campo por
 * campo, nunca quitando lo prohibido: `relayScope.test.ts` obliga a
 * clasificar cualquier entidad nueva o falla.
 */
export function buildGroupPayload(groupId: string, currentUserId: string): SyncDelta {
  // El armado campo por campo (qué le pertenece a `groupId`, elisión de mail
  // y `avatarUrl`) vive en `adaptador.armar` (frontera P15, T-191 Task 0).
  // Acá sólo se envuelve con el sobre.
  const doc = adaptador.armar(groupId, currentUserId);

  return {
    version: 1,
    featureVersion: DELTA_FEATURE_VERSION,
    fromUserId: currentUserId,
    timestamp: Date.now(),

    // Re-tipado del `Documento` genérico del núcleo a lo que cada campo de
    // `SyncDelta` es en verdad — `adaptador.armar` ya garantiza el store de origen.
    groups: doc.groups as SyncDelta['groups'],
    expenses: doc.expenses as SyncDelta['expenses'],
    payments: doc.payments as SyncDelta['payments'],
    // Perfiles de miembros: sin ellos el otro ve ids en vez de nombres. El
    // email se saca en `adaptador.armar` (T-093 ronda 2 / R-2).
    users: doc.users as SyncDelta['users'],
    recurring: doc.recurring as SyncDelta['recurring'],
    comments: doc.comments as SyncDelta['comments'],

    // `personal` y `groupKeys` NO viajan por acá — ver ADR-003 §1.
  };
}

/**
 * El orden de dependencia (`groups`/`expenses` antes que `users`/`comments`)
 * ya no lo gobierna este tipo: cada campo se publica por su cubo
 * (`publicarCubos.ts`) y la garantía pasó al RECEPTOR (`relay/drenar.ts` +
 * `relay/cierreDeDrenaje.ts`, spec §8 C2). `adaptador.campos` sigue marcando
 * el orden de ENVÍO por defecto, no una garantía.
 */
export type PublishResult =
  | { ok: true; seq: number }
  /**
   * `pending_drain` (T-089): el grupo todavía no drenó su buzón, así que
   * publicar mandaría un estado que puede resucitar lo que el grupo borró
   * mientras este teléfono estuvo afuera. **No es un fallo**: se resuelve solo
   * en cuanto el drenaje termine, y por eso no es bloqueante.
   */
  | { ok: false; reason: 'no_key' | 'too_large' | 'not_configured' | 'network' | 'pending_drain' | 'rate_limited'; detail?: string };

/** Las razones de fallo que de verdad puede devolver `sendEnvelope` — `publicarPorCubos` las pasa tal cual. */
type PublishFailReason = Extract<PublishResult, { ok: false }>['reason'];

/**
 * Timeout del envío individual: un `sendEnvelope` que nunca resuelve no debe
 * dejar la cola de `encolarPorTopic` trabada para siempre (ADR-007 §T-191,
 * verifier tercera tanda).
 */
export const PUBLICACION_TIMEOUT_MS = 15_000;

/**
 * Cola de promesas por topic — una publicación en vuelo por grupo, la
 * siguiente espera a que la anterior TERMINE antes de arrancar la suya.
 * Mismo patrón que Jazz/CoJSON para serializar escrituras por CoValue
 * (`feedback_jazz_referencia_sync.md`). Sin esto, dos publicaciones
 * concurrentes del mismo topic podían responder en orden invertido y dejar
 * el ledger creyendo publicado el digest más nuevo mientras el buzón
 * compactado se quedaba con el contenido viejo (ADR-007 §T-191, verifier
 * segunda tanda). Sólo se encola la fase de ENVÍO — armar el documento no
 * escribe nada compartido y no necesita el turno.
 */
const colaPorTopic = new Map<string, Promise<unknown>>();

/**
 * Envíos individuales que TODAVÍA no se asentaron cuando `enviar` (más abajo)
 * ya devolvió por timeout: el `AbortSignal` cancela casi siempre, pero sin
 * garantía absoluta (ADR-007 §T-191, verifier cuarta tanda). Mientras una
 * promesa cruda siga sin asentarse, la cola no deja arrancar la SIGUIENTE
 * publicación del mismo topic — si no, un envío tardío podría aterrizar
 * después de uno más nuevo y la compactación se quedaría con el viejo.
 */
const pendientesSinAsentarPorTopic = new Map<string, Promise<unknown>[]>();

function registrarPendienteSinAsentar(topic: string, cruda: Promise<unknown>): void {
  const lista = pendientesSinAsentarPorTopic.get(topic) ?? [];
  lista.push(cruda);
  pendientesSinAsentarPorTopic.set(topic, lista);
}

async function encolarPorTopic<T>(topic: string, tarea: () => Promise<T>): Promise<T> {
  const anterior = colaPorTopic.get(topic) ?? Promise.resolve();
  const propia = anterior.then(tarea, tarea);
  // Nunca deja la cola trabada en un rechazo: el siguiente turno arranca
  // igual. `propia` (no la promesa de encadenamiento) es lo que recibe quien
  // llamó, así que nada de esto oculta un fallo real. El turno se libera
  // recién cuando, ADEMÁS de `propia`, cualquier envío "incierto" por
  // timeout (`registrarPendienteSinAsentar`) se asentó.
  const liberacion = propia.catch(() => undefined).then(async () => {
    const pendientes = pendientesSinAsentarPorTopic.get(topic);
    if (pendientes && pendientes.length > 0) {
      pendientesSinAsentarPorTopic.delete(topic);
      await Promise.allSettled(pendientes);
    }
  });
  colaPorTopic.set(topic, liberacion);
  return propia;
}

/**
 * Publica el estado actual en el buzón del grupo, cifrado. Sin la clave del
 * grupo no se publica nada: mandar en claro "por esta vez" es exactamente
 * cómo se filtran los datos.
 *
 * Arma el `Documento` del grupo (`adaptador.armar` + `antesDePublicar`) y se
 * lo pasa a `publicarPorCubos` (núcleo): corta cada campo en cubos ESTABLES
 * por prefijo de id y sólo manda un cubo si cambió su digest contra el
 * ledger local o venció la ventana de renovación. El manifiesto se manda
 * siempre, al final, con el digest de todos los cubos presentes.
 */
export async function publishToGroup(
  groupId: string,
  currentUserId: string,
  deviceId: string,
): Promise<PublishResult> {
  const key = groupKeyBytes(groupId);
  if (!key) return { ok: false, reason: 'no_key' };

  const record = useGroupKeyStore.getState().getKey(groupId)!;
  const topic = await deriveTopic(key, record.epoch);

  const enviar = async (ckey: string, json: string) => {
    const sealed = sealEnvelope(key, json);
    // La firma va POR FUERA del cifrado: autentica quién lo mandó sin exponer
    // nada de lo que va adentro (T-033). Compactable: cada cubo (y el
    // manifiesto) reemplaza al anterior con la misma `ckey` de este
    // dispositivo (T-032 + ADR-007).
    const firmado = signEnvelope(sealed, ensureIdentity().privateKey);
    // `AbortSignal` real + registro en la cola (`registrarPendienteSinAsentar`)
    // para que el SIGUIENTE turno no arranque hasta que esta se asiente —
    // si el pedido viejo aterrizara después de uno más nuevo, la
    // compactación se quedaría con el más viejo (ADR-007 §T-191, verifier
    // cuarta tanda).
    const controller = new AbortController();
    const cruda = sendEnvelope(topic, firmado, deviceId, true, ckey, controller.signal);
    registrarPendienteSinAsentar(topic, cruda);

    const TIMEOUT = Symbol('timeout');
    const venciendo = new Promise<typeof TIMEOUT>((resolve) => {
      setTimeout(() => { controller.abort(); resolve(TIMEOUT); }, PUBLICACION_TIMEOUT_MS);
    });

    const resultado = await Promise.race([cruda, venciendo]);
    if (resultado === TIMEOUT) {
      // El envío queda INCIERTO: no se sabe si el servidor llegó a
      // recibirlo antes de que el abort surtiera efecto. Se olvida esta
      // ckey del ledger (no se registró de todos modos, porque nunca hubo
      // confirmación) para que la PRÓXIMA publicación la reenvíe sin
      // confiar en un digest que puede no reflejar lo que de verdad quedó
      // en el buzón.
      olvidarCubo(adaptador.almacen, topic, deviceId, ckey);
      return { ok: false as const, reason: 'network' as const, detail: 'timeout' };
    }
    return resultado;
  };

  const onExcluidos = (campo: string, excluidos: { id: string }[]) => {
    // Rastro para el diagnóstico (T-150, SEC-07): el registro sigue local,
    // pero no viaja — mandarlo entero rompía la publicación de todos los
    // peers honestos que lo recibieran (`sendEnvelope` rechaza sobres por
    // encima de `MAX_PAYLOAD_BYTES`).
    recordError({
      message: `sync.registro_excluido campo=${campo} ids=${excluidos.slice(0, 5).map(e => e.id).join(',')}`,
      fatal: false, screen: 'sync',
    });
  };

  // `armar`/`antesDePublicar` corren ADENTRO de la tarea encolada, no antes:
  // tomar el estado recién al turno de la cola evita que una llamada vieja
  // pise con un snapshot obsoleto a una más nueva (ADR-007 §T-191, verifier
  // tercera tanda).
  const resultado = await encolarPorTopic(topic, async () => {
    const doc = await adaptador.antesDePublicar(
      adaptador.armar(groupId, currentUserId),
      { groupId, deviceId, fromUserId: currentUserId },
    );
    const campos: CampoDoc[] = adaptador.campos.map(campo => ({
      campo,
      registros: (doc[campo] ?? []) as { id: string }[],
    }));

    return publicarPorCubos(
      campos,
      (campo, registros) => adaptador.envolver(campo, registros, currentUserId),
      key,
      adaptador.almacen,
      topic,
      deviceId,
      Date.now(),
      enviar,
      cederHilo,
      onExcluidos,
    );
  });

  if (!resultado.ok) {
    return { ok: false, reason: resultado.reason as PublishFailReason, detail: resultado.detail };
  }
  return resultado;
}

/**
 * Saca del buzón los sobres que ESTE aparato publicó para el grupo (T-088).
 * Deriva el topic igual que `publishToGroup`. Lo que NO alcanza: los sobres
 * de OTROS miembros (cada uno borra los suyos) ni los de otra instalación de
 * la misma persona — sólo el TTL de 30 días los levanta (ADR-009 §4·A/§10.1).
 * Quien llama (T-074) tiene que purgar el buzón ANTES de destruir la prenda.
 *
 * También olvida el ledger local de cubos de este topic (spec §7/§8 C5(b)):
 * sin esto, tras purgar el buzón el ledger seguiría declarando cubos "ya
 * publicados" sobre un buzón vacío.
 */
export async function deleteMyGroupEnvelopes(
  groupId: string,
): Promise<DeleteResult | { ok: false; reason: 'no_key' }> {
  const key = groupKeyBytes(groupId);
  if (!key) return { ok: false, reason: 'no_key' };

  const record = useGroupKeyStore.getState().getKey(groupId)!;
  const topic = await deriveTopic(key, record.epoch);
  const resultado = await deleteMyEnvelopes(topic);
  olvidarTopicDelLedger(adaptador.almacen, topic);
  return resultado;
}
