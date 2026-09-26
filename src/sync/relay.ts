import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { recordServerTime } from '@/src/utils/syncedClock';
import { prendaDelAparato } from './ownerPledge';

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
 */

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Tope del sobre: **1 MB**, replicado como CHECK en la tabla y en la policy de
 * INSERT (`supabase/006_payload_limit.sql`, corrida por el PO el 2026-09-01).
 *
 * **Este número tiene que moverse junto con los dos del SQL, y el servidor
 * primero.** Al revés, la app cree que puede mandar 1 MB, choca contra un
 * servidor más chico y el publish falla.
 *
 * **OJO: el presupuesto real de datos NO es 1 MB, son ~786 KB.** Lo que se mide
 * acá es el payload que llega a `publish`, y ése ya viene en base64:
 * `sealEnvelope` devuelve base64 (`envelopeCrypto.ts:61`), así que el JSON se
 * infla ×4/3 ANTES de compararse contra este número. Costó descubrirlo dos
 * veces (T-056/T-058) y no estaba escrito en ningún lado.
 *
 * **De dónde salían los 256 KB viejos:** de una línea del engram marcada «no
 * verificados, verificar en el spike», heredada de los límites de Supabase
 * *Realtime* — y los sobres no viajan por Realtime, se leen por REST. Se probó
 * el proyecto real con sondas de 1 KB a 8 MB y ninguna dio 413. **El tope
 * siempre fue nuestro.**
 *
 * Medido con arné real —stores sembrados, sellado y firmado—, no estimado
 * (`__tests__/tamanoDelSobre.bench.test.ts`):
 *
 * | Grupo                          | En el cable | % del tope |
 * |--------------------------------|-------------|------------|
 * | 5 personas, 30 gastos          |    86 KB    |      8 %   |
 * | 5 personas, 200 gastos (6 m)   |   313 KB    |     31 %   |
 * | 5 personas, 700 gastos         |   982 KB    |     96 %   |
 * | 8 personas, 700 gastos         |  1190 KB    |    116 %   |
 *
 * O sea: **la pared se corrió de ~160 gastos a ~720, no desapareció.** El sobre
 * sigue creciendo O(gastos) y sigue habiendo un número a partir del cual el
 * grupo deja de sincronizar para siempre. El arreglo de fondo es ADR-007; la
 * solución NO es filtrar por fecha (el sobre lleva ESTADO a propósito, y tres
 * mecanismos dependen de eso).
 */
export const MAX_PAYLOAD_BYTES = 1_048_576;

export type Envelope = {
  seq: number;
  topic: string;
  payload: string;
  sender: string;
  created_at: string;
  // Ausente en un servidor sin la migración 010 (ADR-007): esas filas llegan
  // sin la columna, y el degradado es "no ckey" — igual que antes de que
  // existiera la compactación por ckey.
  ckey?: string;
};

let client: SupabaseClient | null = null;

/**
 * `null` si el relay no está configurado: la app tiene que seguir andando.
 *
 * **T-147 (D1):** la sesión se persiste — ya no es "la identidad la maneja la
 * app, no Supabase". Sin sesión persistida, cerrar el buzón a `authenticated`
 * (011b) cortaría el sync a todo el mundo en la segunda apertura de la app, no
 * sólo al invitado. El storage es el mismo cifrado at-rest que el resto de los
 * datos sensibles (`relaySession.supabaseAuthStorage`); el refresco automático
 * NO se deja en manos del SDK (`autoRefreshToken: false` acá) — lo maneja
 * `bindAuthRefreshToAppState`, atado a primer plano/fondo.
 */
export function getRelayClient(): SupabaseClient | null {
  if (!URL || !ANON) return null;
  if (!client) {
    // Import perezoso: `relaySession` importa `getRelayClient` de este mismo
    // archivo, y un `import` estático de arriba crearía un ciclo.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { supabaseAuthStorage } = require('./relaySession') as typeof import('./relaySession');
    client = createClient(URL, ANON, {
      auth: {
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage: supabaseAuthStorage(),
      },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return client;
}

export function isRelayConfigured(): boolean {
  return Boolean(URL && ANON);
}

/**
 * La fila que se inserta. Está afuera de `sendEnvelope` para poder testearla
 * sin cliente ni credenciales: configurarlas en un test filtra `process.env` a
 * los demás suites del worker, y ahí el motor arranca su `setInterval` de
 * relectura y Jest no termina nunca. Pasó de verdad — 44 minutos colgado.
 */
export function envelopeRow(
  topic: string,
  payload: string,
  sender: string,
  compactable = false,
  ownerProof?: string | null,
  ckey?: string,
): { topic: string; payload: string; sender: string; compactable: boolean; owner_proof?: string; ckey?: string } {
  const fila: { topic: string; payload: string; sender: string; compactable: boolean; owner_proof?: string; ckey?: string } =
    { topic, payload, sender, compactable };
  // Sin prenda la clave NO aparece: la fila queda idéntica a la de antes de
  // T-088, y por eso un servidor sin la migración 008 la acepta igual.
  if (ownerProof) fila.owner_proof = ownerProof;
  // Sin ckey la fila queda igual que antes de la compactación por ckey
  // (ADR-007): un servidor sin la migración correspondiente la acepta igual.
  if (ckey) fila.ckey = ckey;
  return fila;
}

/**
 * El servidor no conoce la columna de la prenda: migración 008 sin aplicar, o
 * un rollback. Se aprende del primer rechazo y se recuerda por lo que dura la
 * sesión — **no se persiste a propósito**: un flag pegado en el storage sería
 * una app que dejó de proteger sus sobres para siempre y nadie se entera.
 */
let servidorSinPrenda = false;

function esRechazoDeLaPrenda(mensaje: string): boolean {
  // Por el TEXTO y no por el código: no está verificado cuál emite esta versión
  // de PostgREST ante una columna que no existe (T-088 §8.1).
  return /owner_proof/i.test(mensaje);
}

/**
 * El servidor no tiene la migración 011a: no existe `publish_envelope` ni
 * `fetch_since` (T-147 D4/H1). Igual que `servidorSinPrenda`, se aprende del
 * primer rechazo y NO se persiste — es el degradado de la sesión, nunca del
 * disco (compatibilidad F2: el cliente nuevo habla con la base de hoy).
 */
let servidorSinRpcPublish = false;
let servidorSinRpcFetch = false;

/**
 * ¿Este error es "la función no existe en este proyecto"? — la RPC todavía no
 * se corrió (011a pendiente), no un fallo transitorio. `PGRST202` es el código
 * de PostgREST; `42883` el de Postgres directo; el texto es la red de
 * seguridad para versiones que no mandan ninguno de los dos.
 */
export function esFuncionAusente(e: { code?: string; message: string }): boolean {
  return e.code === 'PGRST202' || e.code === '42883'
    || /could not find the function/i.test(e.message)
    || /function .*does not exist/i.test(e.message);
}

/**
 * ¿Este error es el freno de la cuota (T-147 D3)? `PT429` es el código propio
 * que usa `relay_enforce_quota`; el texto es la red de seguridad si PostgREST
 * no llega a mapearlo. **No es un error de red**: reintentar en el momento
 * sólo empeora, por eso no cae a ningún fallback (H6).
 */
export function esLimiteDeRitmo(e: { code?: string; message: string }): boolean {
  return e.code === 'PT429' || /relay_quota_exceeded/i.test(e.message);
}

export type SendResult =
  | { ok: true; seq: number }
  | { ok: false; reason: 'not_configured' | 'too_large' | 'network' | 'rate_limited'; detail?: string };

/**
 * Deja un sobre en el buzón del topic.
 * No espera a que nadie lo lea: si el destinatario está offline, queda encolado.
 */
/**
 * `compactable`: este sobre REEMPLAZA a los anteriores del mismo remitente en
 * el mismo topic, y el servidor los borra (T-032).
 *
 * Sólo vale para los sobres de grupo, que llevan **estado completo**. Los de
 * contacto e invitación llevan MENSAJES distintos por el mismo canal —una
 * tarjeta y una entrega de clave— y compactarlos borraría el que el otro
 * todavía no leyó.
 */
export async function sendEnvelope(
  topic: string,
  payload: string,
  sender: string,
  compactable = false,
  ckey?: string,
): Promise<SendResult> {
  const supabase = getRelayClient();
  if (!supabase) return { ok: false, reason: 'not_configured' };

  // Se chequea acá además del CHECK en la tabla: así el error es accionable en
  // el cliente en vez de un 400 opaco de Postgres.
  if (byteLength(payload) > MAX_PAYLOAD_BYTES) {
    return { ok: false, reason: 'too_large' };
  }

  // La prenda de escritura (ADR-009 D-1): lo que viaja es la huella del
  // secreto, nunca el secreto. Si no hay, se publica sin ella — un sobre sin
  // prenda se comporta como los de antes de T-088.
  const proof = servidorSinPrenda ? null : (prendaDelAparato()?.proof ?? null);

  // La hora local ANTES del pedido: tomarla después metería la latencia dentro
  // del desfase que vamos a calcular.
  const antes = Date.now();

  // T-147 (D4/H1): publicar por RPC — un INSERT directo con `.select()` exige
  // la policy de SELECT sobre `envelopes`, y 011b la borra (PostgREST hace el
  // INSERT con RETURNING por dentro). Se cae al insert de hoy SÓLO si la RPC
  // no existe todavía (servidor sin 011a); cualquier otro error (red, cuota)
  // se devuelve tal cual, sin fallback.
  if (!servidorSinRpcPublish) {
    const { data, error } = await supabase.rpc('publish_envelope', {
      p_topic: topic,
      p_payload: payload,
      p_sender: sender,
      p_compactable: compactable,
      p_owner_proof: proof,
      p_ckey: ckey ?? null,
    });

    if (!error) {
      const fila = (data as { seq: number; created_at?: string }[])[0]!;
      if (fila.created_at) recordServerTime(fila.created_at, antes);
      return { ok: true, seq: fila.seq };
    }

    if (esFuncionAusente(error)) {
      servidorSinRpcPublish = true;
      // sigue abajo por el camino viejo, sin volver a chequear la RPC
    } else if (esLimiteDeRitmo(error)) {
      return { ok: false, reason: 'rate_limited', detail: error.message };
    } else {
      return { ok: false, reason: 'network', detail: error.message };
    }
  }

  const { data, error } = await supabase
    .from('envelopes')
    .insert(envelopeRow(topic, payload, sender, compactable, proof, ckey))
    .select('seq,created_at')
    .single();

  if (error) {
    // Servidor sin la columna: el sobre no se insertó, así que reintentar no
    // duplica nada. Sin esto, desplegar la app antes que la migración deja al
    // grupo sin sincronizar.
    if (proof && esRechazoDeLaPrenda(error.message)) {
      servidorSinPrenda = true;
      return sendEnvelope(topic, payload, sender, compactable, ckey);
    }
    // La cuota (`relay_enforce_quota`) corre también sobre el INSERT directo:
    // el trigger no distingue el camino de escritura.
    if (esLimiteDeRitmo(error)) return { ok: false, reason: 'rate_limited', detail: error.message };
    return { ok: false, reason: 'network', detail: error.message };
  }

  // El servidor estampó `created_at` al insertar: es un reloj único para todos
  // los dispositivos, y llega gratis en la respuesta (ADR-005).
  const fila = data as { seq: number; created_at?: string };
  if (fila.created_at) recordServerTime(fila.created_at, antes);

  return { ok: true, seq: fila.seq };
}

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
  if (!servidorSinRpcFetch) {
    const { data, error } = await supabase.rpc('fetch_since', {
      p_topic: topic,
      p_since: sinceSeq,
      p_exclude_sender: excludeSender ?? null,
      p_limit: limit,
    });

    if (!error) {
      const filas = (data ?? []) as (Envelope & { more?: boolean })[];
      const envelopes = filas.map(({ more: _more, ...resto }) => ({ ...resto, topic })) as Envelope[];
      const cursor = envelopes.length > 0 ? envelopes[envelopes.length - 1]!.seq : sinceSeq;
      const more = filas.length > 0 ? Boolean(filas[0]!.more) : false;
      return { ok: true, envelopes, cursor, more };
    }

    if (esFuncionAusente(error)) {
      servidorSinRpcFetch = true;
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
export function subscribeTopic(topic: string, onNews: () => void): () => void {
  const supabase = getRelayClient();
  if (!supabase) return () => {};

  const channel = supabase
    .channel(`envelopes:${topic}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'envelopes', filter: `topic=eq.${topic}` },
      () => onNews(),
    )
    .subscribe();

  return () => { void supabase.removeChannel(channel); };
}

function byteLength(s: string): number {
  // `length` cuenta unidades UTF-16: con acentos o emoji miente respecto de los
  // bytes que viajan, que es lo que el servidor limita.
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export { byteLength };
