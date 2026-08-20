import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { recordServerTime } from '@/src/utils/syncedClock';

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

/** Tope del ADR (256 KB), replicado como CHECK en la tabla. */
export const MAX_PAYLOAD_BYTES = 262_144;

export type Envelope = {
  seq: number;
  topic: string;
  payload: string;
  sender: string;
  created_at: string;
};

let client: SupabaseClient | null = null;

/** `null` si el relay no está configurado: la app tiene que seguir andando. */
export function getRelayClient(): SupabaseClient | null {
  if (!URL || !ANON) return null;
  if (!client) {
    client = createClient(URL, ANON, {
      auth: { persistSession: false }, // la identidad la maneja la app, no Supabase
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
): { topic: string; payload: string; sender: string; compactable: boolean } {
  return { topic, payload, sender, compactable };
}

export type SendResult =
  | { ok: true; seq: number }
  | { ok: false; reason: 'not_configured' | 'too_large' | 'network'; detail?: string };

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
): Promise<SendResult> {
  const supabase = getRelayClient();
  if (!supabase) return { ok: false, reason: 'not_configured' };

  // Se chequea acá además del CHECK en la tabla: así el error es accionable en
  // el cliente en vez de un 400 opaco de Postgres.
  if (byteLength(payload) > MAX_PAYLOAD_BYTES) {
    return { ok: false, reason: 'too_large' };
  }

  // La hora local ANTES del pedido: tomarla después metería la latencia dentro
  // del desfase que vamos a calcular.
  const antes = Date.now();

  const { data, error } = await supabase
    .from('envelopes')
    .insert(envelopeRow(topic, payload, sender, compactable))
    .select('seq,created_at')
    .single();

  if (error) return { ok: false, reason: 'network', detail: error.message };

  // El servidor estampó `created_at` al insertar: es un reloj único para todos
  // los dispositivos, y llega gratis en la respuesta (ADR-005).
  const fila = data as { seq: number; created_at?: string };
  if (fila.created_at) recordServerTime(fila.created_at, antes);

  return { ok: true, seq: fila.seq };
}

export type FetchResult =
  | { ok: true; envelopes: Envelope[]; cursor: number }
  | { ok: false; reason: 'not_configured' | 'network'; detail?: string };

/**
 * Lee lo pendiente del topic desde el cursor.
 *
 * `sinceSeq` es exclusivo: se piden los estrictamente posteriores. El cursor
 * que devuelve es el mayor `seq` leído, y sólo debe persistirse DESPUÉS de
 * haber aplicado los sobres — si se guarda antes y la app muere en el medio,
 * esos sobres no se vuelven a pedir nunca.
 */
export async function fetchSince(
  topic: string,
  sinceSeq: number,
  excludeSender?: string,
  limit = 200,
): Promise<FetchResult> {
  const supabase = getRelayClient();
  if (!supabase) return { ok: false, reason: 'not_configured' };

  let query = supabase
    .from('envelopes')
    .select('seq,topic,payload,sender,created_at')
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
  return { ok: true, envelopes, cursor };
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
