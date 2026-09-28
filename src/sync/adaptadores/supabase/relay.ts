import { prendaDelAparato } from './ownerPledge';
import { tocaReintentar, esFuncionAusente } from './relayErrors';
import { getRelayClient, isRelayConfigured as isRelayConfiguredImpl, type Envelope } from './relayClient';

/**
 * Transporte del relay (ADR-003). Buzón store-and-forward.
 *
 * El servidor es un buzón TONTO: guarda sobres opacos y los entrega cuando el
 * destinatario aparece. Este módulo no sabe nada de gastos ni de cifrado — sólo
 * mueve strings. La cerradura va en una capa de arriba, a propósito: primero
 * que el sobre viaje y llegue, después que nadie lo pueda abrir.
 *
 * Dos invariantes que vienen del ADR y NO son detalles:
 *
 *  1. **El push realtime es un aviso, nunca la fuente de verdad.** La verdad se
 *     lee siempre por `seq` desde el cursor. Si el aviso se pierde —app en
 *     background, red que se cortó, websocket caído— la próxima lectura lo
 *     recupera igual. Tratar el push como fuente de verdad es cómo se pierden
 *     mensajes en silencio.
 *  2. **Los sobres llevan ESTADO, no operaciones.** Por eso se pueden expirar a
 *     los 30 días sin perder datos: un estado viejo lo reemplaza el nuevo. Si
 *     alguna vez se manda algo incremental ("sumale 500"), este diseño pasa a
 *     perder datos en silencio.
 *
 * Cliente Supabase, `MAX_PAYLOAD_BYTES` y el tipo `Envelope` viven en
 * `relayClient.ts` (T-192): `relaySend.ts` los necesita también, y si los
 * definiera acá crearía un ciclo (este archivo re-exporta `sendEnvelope` de
 * `relaySend.ts`, más abajo).
 */
export { getRelayClient, MAX_PAYLOAD_BYTES, type Envelope } from './relayClient';

// `isRelayConfigured` queda como función propia (no re-export directo): un
// re-export vive de un getter no configurable, y `relayEngine.test.ts`
// necesita poder `jest.spyOn(relay, 'isRelayConfigured')` — mismo
// comportamiento de siempre, sólo delega en `relayClient.ts`.
export function isRelayConfigured(): boolean {
  return isRelayConfiguredImpl();
}

/**
 * El servidor no tiene la migración 011a: no existe `fetch_since` (T-147
 * D4/H1). Mismo patrón de degradado por sesión que `servidorSinRpcPublish`
 * (`relaySend.ts`) — ver ahí el porqué completo (D6, compatibilidad F2).
 */
let servidorSinRpcFetch = false;
let momentoSinRpcFetch = 0;

export type DeleteResult =
  | { ok: true; deleted: number }
  | { ok: false; reason: 'not_configured' | 'no_pledge' | 'network'; detail?: string };

/**
 * Borra del buzón los sobres que ESTE aparato publicó en ese topic.
 *
 * Se presenta el PREIMAGEN de la prenda; el servidor lo hashea y compara
 * (ADR-009 D-2). Conocer la huella —que es pública, la lectura del buzón es
 * abierta— no habilita nada.
 *
 * `no_pledge` NO es un error de red: es «este aparato no tiene con qué probar
 * que escribió eso» — reinstalación, o sobres anteriores a T-088. **Esos sólo
 * los levanta el TTL de 30 días, y ninguna pantalla puede prometer otra cosa.**
 *
 * A diferencia de `sendEnvelope`, acá NO hay degradado: si la función no existe
 * en el servidor, se devuelve el error. Un borrado que «funciona» contra un
 * servidor que no borró nada es peor que un error.
 */
export async function deleteMyEnvelopes(topic: string): Promise<DeleteResult> {
  const supabase = getRelayClient();
  if (!supabase) return { ok: false, reason: 'not_configured' };

  const prenda = prendaDelAparato();
  if (!prenda) return { ok: false, reason: 'no_pledge' };

  const { data, error } = await supabase.rpc('delete_my_envelopes', {
    p_topic: topic,
    p_secret: prenda.secret,
  });

  if (error) return { ok: false, reason: 'network', detail: error.message };
  return { ok: true, deleted: typeof data === 'number' ? data : 0 };
}

export type FetchResult =
  | { ok: true; envelopes: Envelope[]; cursor: number; more?: boolean }
  | { ok: false; reason: 'not_configured' | 'network'; detail?: string };

/**
 * Lee lo pendiente del topic desde el cursor.
 *
 * `sinceSeq` es exclusivo: se piden los estrictamente posteriores. El cursor
 * que devuelve es el mayor `seq` leído, y sólo debe persistirse DESPUÉS de
 * haber aplicado los sobres — si se guarda antes y la app muere en el medio,
 * esos sobres no se vuelven a pedir nunca.
 */
/**
 * Columnas que trae `fetchSince`. Exportada para poder testear sin mockear
 * Supabase (T-088 §revisión Task 6): antes `ckey` se escribía pero nunca se
 * releía, y el chequeo de manifiesto quedaba permanentemente roto en
 * producción sin que ningún test lo notara — los mocks de los tests le
 * pegaban `ckey` a mano a las filas.
 */
export const ENVELOPES_SELECT = 'seq,topic,payload,sender,created_at,ckey';

export async function fetchSince(
  topic: string,
  sinceSeq: number,
  excludeSender?: string,
  limit = 200,
): Promise<FetchResult> {
  const supabase = getRelayClient();
  if (!supabase) return { ok: false, reason: 'not_configured' };

  // T-147 (D4): leer por RPC — 011b borra la policy de SELECT directo sobre
  // `envelopes`. `more` viene de la RPC (tope de 4 MB por página, I4); un
  // servidor sin 011a no la manda, y el drenaje cae a "página corta = fondo"
  // (`relaySync.ts`). Cualquier error que NO sea "función ausente" se
  // devuelve tal cual — NUNCA cae al SELECT: un fallback por red ensuciaría el
  // criterio de corte (0 GET directos durante 7 días).
  if (!servidorSinRpcFetch || tocaReintentar(momentoSinRpcFetch)) {
    const { data, error } = await supabase.rpc('fetch_since', {
      p_topic: topic,
      p_since: sinceSeq,
      p_exclude_sender: excludeSender ?? null,
      p_limit: limit,
    });

    if (!error) {
      servidorSinRpcFetch = false; // D6: la RPC volvió — se abandona el degradado
      const filas = (data ?? []) as (Envelope & { more?: boolean })[];
      const envelopes = filas.map(({ more: _more, ...resto }) => ({ ...resto, topic })) as Envelope[];
      const cursor = envelopes.length > 0 ? envelopes[envelopes.length - 1]!.seq : sinceSeq;
      const more = filas.length > 0 ? Boolean(filas[0]!.more) : false;
      return { ok: true, envelopes, cursor, more };
    }

    if (esFuncionAusente(error)) {
      servidorSinRpcFetch = true;
      momentoSinRpcFetch = Date.now();
      // sigue abajo por el SELECT de siempre, sin volver a chequear la RPC
    } else {
      return { ok: false, reason: 'network', detail: error.message };
    }
  }

  let query = supabase
    .from('envelopes')
    .select(ENVELOPES_SELECT)
    .eq('topic', topic)
    .gt('seq', sinceSeq)
    .order('seq', { ascending: true })
    .limit(limit);

  // Los propios no se reprocesan: ya se aplicaron localmente antes de enviarse.
  if (excludeSender) query = query.neq('sender', excludeSender);

  const { data, error } = await query;
  if (error) return { ok: false, reason: 'network', detail: error.message };

  const envelopes = (data ?? []) as Envelope[];
  const cursor = envelopes.length > 0 ? envelopes[envelopes.length - 1]!.seq : sinceSeq;
  // Servidor viejo: no manda `more`, así que el drenaje sigue usando "página
  // corta = fondo" (`envelopes.length >= limit` = puede haber más).
  return { ok: true, envelopes, cursor, more: envelopes.length >= limit };
}

/**
 * Avisa cuando entra algo nuevo en el topic. Devuelve la función para cortar.
 *
 * OJO: el callback NO recibe el sobre. Es deliberado — recibe sólo la señal
 * "hay novedades", y quien la recibe debe ir a leer por cursor. Si el callback
 * trajera el dato, la tentación de aplicarlo directo rompería el invariante (1)
 * y se perderían los sobres que llegaron mientras el socket estaba caído.
 */
/**
 * T-147 (D5): además del `postgres_changes` de siempre, se escucha un canal de
 * Broadcast PRIVADO (`envelopes:<topic>`, `config: { private: true }`) —
 * después de 011b, revocar el SELECT directo también apaga `postgres_changes`
 * (Realtime aplica la RLS), así que el aviso pasa a un trigger de la base que
 * publica ahí. Es privado en los dos sentidos: sólo `authenticated` puede
 * ESCUCHARLO (policy de `realtime.messages`) y nadie puede PUBLICAR desde el
 * cliente (no hay policy de insert) — así que no se pueden falsificar avisos.
 *
 * Mientras conviven servidores con y sin 011a, se escuchan los DOS canales:
 * cualquiera de los dos dispara `onNews()`. El de `postgres_changes` se saca
 * en un ticket de limpieza posterior a 011b (los servidores sin 011a todavía
 * lo necesitan).
 */
/**
 * `onStatus` (T-158a, DEC-04): avisa si el canal PRIVADO —el que sobrevive a
 * 011b— está `SUBSCRIBED` (`true`) o no (`CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`,
 * `false`). El motor lo usa para decidir cada cuánto vale la pena releer por
 * cursor: con el socket sano, el aviso realtime ya cubre casi todo y el poll
 * de respaldo puede espaciarse; caído, hay que volver a la cadencia corta de
 * siempre. El canal PÚBLICO (`postgres_changes`, de compatibilidad con
 * servidores sin 011a) no se reporta acá — ver el JSDoc de arriba.
 */
export function subscribeTopic(topic: string, onNews: () => void, onStatus?: (ok: boolean) => void): () => void {
  const supabase = getRelayClient();
  if (!supabase) return () => {};

  const privado = supabase
    .channel(`envelopes:${topic}`, { config: { private: true } })
    .on('broadcast', { event: 'news' }, () => onNews())
    .subscribe((status) => { onStatus?.(status === 'SUBSCRIBED'); });

  const publico = supabase
    .channel(`envelopes-pgc:${topic}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'envelopes', filter: `topic=eq.${topic}` },
      () => onNews(),
    )
    .subscribe();

  return () => { void supabase.removeChannel(privado); void supabase.removeChannel(publico); };
}

// T-192: `sendEnvelope` salió a `relaySend.ts`, `esFuncionAusente` a
// `relayErrors.ts`. Re-exportados para que la ruta pública `@/src/sync/relay`
// no cambie — los dos tienen consumidores de producción reales (`publicar.ts`,
// `contactChannel.ts`, etc. / `deviceKeys.ts`).
//
// T-206-A (D9): acá también re-exportaban `envelopeRow`, `esLimiteDeRitmo`,
// `RPC_REINTENTO_MS` y `byteLength` — sin ningún consumidor de producción
// (`esLimiteDeRitmo` no tenía ninguno en absoluto, ni de test). Sus 4 tests
// pasan a importar del dueño (`relaySend.ts`/`relayErrors.ts`) directo.
export { sendEnvelope, type SendResult } from './relaySend';
export { esFuncionAusente } from './relayErrors';
