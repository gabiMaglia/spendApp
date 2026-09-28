import { recordServerTime } from '@/src/utils/syncedClock';
import { prendaDelAparato } from './ownerPledge';
import { getRelayClient, MAX_PAYLOAD_BYTES } from './relayClient';
import { tocaReintentar, esFuncionAusente, esLimiteDeRitmo, byteLength } from './relayErrors';

/**
 * `sendEnvelope` y su fila (T-192 — salió de `relay.ts`, mismo código).
 * Deja un sobre en el buzón del topic; no espera a que nadie lo lea.
 */

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
 * El servidor no tiene la migración 011a: no existe `publish_envelope`
 * (T-147 D4/H1). Se aprende del primer rechazo y NO se persiste — es el
 * degradado de la sesión, nunca del disco (compatibilidad F2). Pasado
 * `RPC_REINTENTO_MS` se vuelve a probar la RPC (D6, ver `relay.ts` para el
 * mismo patrón del lado de `fetchSince`).
 */
let servidorSinRpcPublish = false;
let momentoSinRpcPublish = 0;

export type SendResult =
  | { ok: true; seq: number }
  | { ok: false; reason: 'not_configured' | 'too_large' | 'network' | 'rate_limited'; detail?: string };

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
  // T-191 (verifier, cuarta tanda): quien llama con un presupuesto de tiempo
  // (`publishToGroup`, `publishAvatarIfOwn`) puede pasar un `AbortSignal` —
  // al vencer, cancela la request DE VERDAD en vez de sólo dejar de
  // esperarla (`abortSignal`, soportado por `postgrest-js` 2.x en las dos
  // builders que se usan acá: `PostgrestTransformBuilder.abortSignal`,
  // `node_modules/@supabase/postgrest-js/src/PostgrestTransformBuilder.ts:642-645`,
  // que tanto `.rpc()` como `.from().insert()` heredan). Sin esto, un envío
  // que "venció" del lado del cliente podía aterrizar en el servidor de
  // todos modos, más tarde, pisando una publicación más nueva del mismo
  // dispositivo (T-191, hallazgo verifier tercera tanda sobre M2).
  signal?: AbortSignal,
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
  if (!servidorSinRpcPublish || tocaReintentar(momentoSinRpcPublish)) {
    let builder = supabase.rpc('publish_envelope', {
      p_topic: topic,
      p_payload: payload,
      p_sender: sender,
      p_compactable: compactable,
      p_owner_proof: proof,
      p_ckey: ckey ?? null,
    });
    if (signal) builder = builder.abortSignal(signal);
    const { data, error } = await builder;

    if (!error) {
      servidorSinRpcPublish = false; // D6: la RPC volvió — se abandona el degradado
      const fila = (data as { seq: number; created_at?: string }[])[0]!;
      if (fila.created_at) recordServerTime(fila.created_at, antes);
      return { ok: true, seq: fila.seq };
    }

    if (esFuncionAusente(error)) {
      servidorSinRpcPublish = true;
      momentoSinRpcPublish = Date.now();
      // sigue abajo por el camino viejo, sin volver a chequear la RPC
    } else if (esLimiteDeRitmo(error)) {
      return { ok: false, reason: 'rate_limited', detail: error.message };
    } else {
      return { ok: false, reason: 'network', detail: error.message };
    }
  }

  let builderInsert = supabase
    .from('envelopes')
    .insert(envelopeRow(topic, payload, sender, compactable, proof, ckey))
    .select('seq,created_at');
  if (signal) builderInsert = builderInsert.abortSignal(signal);
  const { data, error } = await builderInsert.single();

  if (error) {
    // Servidor sin la columna: el sobre no se insertó, así que reintentar no
    // duplica nada. Sin esto, desplegar la app antes que la migración deja al
    // grupo sin sincronizar.
    if (proof && esRechazoDeLaPrenda(error.message)) {
      servidorSinPrenda = true;
      return sendEnvelope(topic, payload, sender, compactable, ckey, signal);
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
