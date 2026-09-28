import type { SyncDelta } from '../applyDelta';
import { deriveTopic } from '../envelopeCrypto';
import { fetchSince } from '../relay';
import { groupKeyBytes, useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useAuthStore } from '@/src/store/authStore';
import { observeAuthor, RECHAZAR_AUTORES_NO_VERIFICADOS } from '../authorHealth';
import { refreshPendingAuthors } from '../authorKeys';
import { digestOfJson, type SliceManifest } from '../manifest';
import { registrarFalloDeAplicacion, agotoReintentos } from '../drainFailures';
import { cederHilo } from '../cederHilo';
import * as adaptador from './adaptadorHushSplit';
import * as appliedSlices from './appliedSlices';
import { aplicarDeltaAcotado } from './aplicarAcotado';
import { DRAIN_FETCH_LIMIT, DRAIN_MAX_PAGES } from './relectura';
import { sigueSiendoLaClave } from './claveVigente';
import { abrirSobre } from './abrirSobre';
import { cursorFinal, completoFinal, clasificarRetenidas, quitarNoResueltas, type Retenida } from './cierreDeDrenaje';
import { chequearManifiestos } from './chequeoManifiesto';
import type { DrainResult, DrainOptions } from './drenarTypes';

export { DRAIN_FETCH_LIMIT, DRAIN_MAX_PAGES } from './relectura';
export { sigueSiendoLaClave } from './claveVigente';
export type { DrainResult, DrainOptions } from './drenarTypes';

type Rebanada = { seq: number; ckey?: string; sender: string; delta: SyncDelta; senderKey: string; json: string };

/**
 * Baja lo pendiente del grupo, lo descifra y lo aplica. `skipped` cuenta los
 * sobres que no se pudieron abrir — no es un error, cualquiera puede
 * inyectar basura en un topic conocido.
 *
 * Desde T-146: se pagina hasta una página corta, una rebanada que tira NO se
 * da por leída (el cursor vuelve justo antes, hasta `DRAIN_MAX_REINTENTOS`),
 * y `completo` le dice a `drainNow` si puede limpiar la marca de T-089. El
 * cierre (qué queda retenido, dónde corta el cursor) vive en
 * `cierreDeDrenaje.ts` (núcleo puro, T-192 Task 3).
 */
export async function drainGroup(
  groupId: string,
  currentUserId: string,
  deviceId: string,
  sinceSeq: number,
  opts: DrainOptions = {},
): Promise<DrainResult> {
  const pageLimit = opts.pageLimit ?? DRAIN_FETCH_LIMIT;
  const maxPages = opts.maxPages ?? DRAIN_MAX_PAGES;

  // Verifier ciego (B3): foto de la SESIÓN ACTIVA al arrancar — se compara
  // contra sí misma más abajo, justo antes de aplicar: importa si la sesión
  // CAMBIÓ durante el drenaje, no si coincide con `currentUserId`.
  const sesionAlArrancar = useAuthStore.getState().currentUser?.id ?? null;

  const key = groupKeyBytes(groupId);
  if (!key) return { ok: false, reason: 'no_key' };

  const record = useGroupKeyStore.getState().getKey(groupId)!;
  const topic = await deriveTopic(key, record.epoch);

  let cursor = sinceSeq;
  let applied = 0;
  let skipped = 0;
  let completo = false;

  // Lo que el chequeo de manifiesto necesita ver ENTERO, acumulado a través
  // de las páginas: qué rebanadas llegaron de cada remitente y qué
  // manifiestos. Un manifiesto puede caer en una página y sus rebanadas en otra.
  const recibidasPorRemitente = new Map<string, Map<string, string>>();
  const manifiestos: { sender: string; manifest: SliceManifest; senderKey: string; seq: number }[] = [];
  let seLlamoAntesDeAplicar = false;

  // T-191 (spec §8 C2): rebanadas aplicadas con descartes POR DEPENDENCIA —
  // se reintentan al final, cuando `groups`/`expenses` de la misma tanda ya
  // tuvieron chance de llegar por su propio cubo.
  const retenidasPorDependencia: Rebanada[] = [];

  // Un fallo con reintentos agotados rompe los DOS loops (`paginas:`) en vez
  // de retornar directo — la reaplicación de retenidas SIEMPRE corre antes
  // de devolver (ADR-007 §T-191, verifier segunda tanda).
  let salidaTemprana: { cursor: number } | null = null;
  // Distingue el corte de red en página POSTERIOR (no cobra cupo a las
  // retenidas) del tope de páginas (si cobra) — spec §8 C2.
  let corteDeRed = false;

  paginas: for (let pagina = 0; pagina < maxPages; pagina++) {
    const r = await fetchSince(topic, cursor, deviceId, pageLimit);
    if (!r.ok) {
      if (pagina === 0) return { ok: false, reason: r.reason, detail: r.detail };
      corteDeRed = true;
      break;
    }

    // T-136 · D-1: la clave cambió mientras se esperaba la red.
    if (!sigueSiendoLaClave(groupId, record)) return { ok: false, reason: 'key_changed' };

    // ADR-007: cada página son DOS pasadas — colección (abrir/clasificar,
    // sin aplicar) y aplicación EN EL MISMO ORDEN de `seq` (load-bearing:
    // `users`/`comments` dependen de `groups`/`expenses` de la MISMA
    // publicación ya aplicados).
    const rebanadas: Rebanada[] = [];

    for (let i = 0; i < r.envelopes.length; i++) {
      // T-157b: cede el hilo ENTRE aperturas — no es síncrono de punta a
      // punta (`observeAuthor` más abajo tiene su propio `await`), por eso
      // el rechequeo de `sigueSiendoLaClave` de abajo no es paranoia.
      if (i > 0) await cederHilo();
      const abierto = abrirSobre(r.envelopes[i]!, key, topic);
      if (abierto.tipo === 'descartado') { skipped++; continue; }
      if (abierto.tipo === 'manifiesto') { manifiestos.push(abierto); continue; }

      rebanadas.push(abierto);
      if (abierto.ckey) {
        let mapa = recibidasPorRemitente.get(abierto.sender);
        if (!mapa) { mapa = new Map(); recibidasPorRemitente.set(abierto.sender, mapa); }
        mapa.set(abierto.ckey, abierto.json);
      }
    }

    // Verifier ciego (B3): rechequeo justo antes de aplicar — la colección
    // cedió el hilo varias veces y en ese hueco puede haber pasado un
    // logout o un cambio de clave. Si algo cambió, la página se aborta
    // ENTERA: nada se aplica ni se mueve el cursor.
    if (rebanadas.length > 0) {
      const sesionSigueSiendoLaMisma = (useAuthStore.getState().currentUser?.id ?? null) === sesionAlArrancar;
      if (!sesionSigueSiendoLaMisma || !sigueSiendoLaClave(groupId, record)) {
        return { ok: false, reason: 'key_changed' };
      }
    }

    // T-158b: la foto previa se toma UNA sola vez, la primera vez que una
    // página trae rebanadas de datos que aplicar.
    if (!seLlamoAntesDeAplicar && rebanadas.length > 0) {
      opts.antesDeAplicar?.();
      seLlamoAntesDeAplicar = true;
    }

    for (const { seq, ckey, sender, delta, senderKey, json } of rebanadas) {
      // Ronda 1 del verifier (D1): TODO lo que puede tirar por esta rebanada
      // —incluida la observación de autoría— pasa por el MISMO camino de
      // `drainFailures` (reintentos + rastro + skip).
      try {
        // 3. Autoría (ADR-004 fase B/T-033): modo AVISO por default, nunca
        // descarta salvo `RECHAZAR_AUTORES_NO_VERIFICADOS` + `clave_desconocida`.
        const veredicto = await observeAuthor(groupId, delta.fromUserId, senderKey);
        if (RECHAZAR_AUTORES_NO_VERIFICADOS && veredicto === 'clave_desconocida') {
          skipped++;
          continue;
        }

        // S3-A1: firma y cifrado sólo prueban quién mandó y que tiene la
        // clave del TOPIC — nunca acotan qué viene adentro.
        const descartes = await aplicarDeltaAcotado(groupId, currentUserId, delta);
        applied++;

        if (descartes.porDependencia > 0) {
          retenidasPorDependencia.push({ seq, ckey, sender, delta, senderKey, json });
        } else if (ckey) {
          appliedSlices.registrar(adaptador.almacen, topic, sender, ckey, {
            digest: await digestOfJson(json), seq, senderKey,
          });
        }
      } catch (e) {
        // TEC-01: se anota y, con presupuesto, el cursor vuelve justo ANTES
        // de esta rebanada para que la próxima vuelta la vuelva a pedir.
        registrarFalloDeAplicacion(topic, seq, e);
        if (!agotoReintentos(topic, seq)) {
          void refreshPendingAuthors();
          salidaTemprana = { cursor: seq - 1 };
          break paginas;
        }
        skipped++;
      }
    }

    cursor = r.cursor;
    // T-147 (D4): página corta = fondo (con o sin `more` del servidor).
    const hayMas = r.more ?? r.envelopes.length >= pageLimit;
    if (!hayMas) { completo = true; break; }
  }

  // V2b (spec §8 C2): reaplicar al final lo que quedó retenido en CUALQUIER
  // página. El cupo se cobra (ajuste A) sólo si este drenaje llegó al fondo
  // o al tope de páginas — nunca en salida temprana o corte de red.
  const debeCobrarCupo = !salidaTemprana && !corteDeRed;
  const resultadosRetenidas: { retenida: Retenida; siguePendiente: boolean; agotada: boolean }[] = [];

  for (const { seq, ckey, sender, delta, senderKey, json } of retenidasPorDependencia) {
    let siguePendiente = false;
    try {
      const descartes = await aplicarDeltaAcotado(groupId, currentUserId, delta);
      if (descartes.porDependencia === 0) {
        if (ckey) {
          appliedSlices.registrar(adaptador.almacen, topic, sender, ckey, {
            digest: await digestOfJson(json), seq, senderKey,
          });
        }
      } else {
        siguePendiente = true;
        if (debeCobrarCupo) registrarFalloDeAplicacion(topic, seq, new Error('dependencia_pendiente'));
      }
    } catch (e) {
      registrarFalloDeAplicacion(topic, seq, e);
      siguePendiente = true;
    }
    resultadosRetenidas.push({
      retenida: { seq, ckey, sender }, siguePendiente,
      agotada: siguePendiente && agotoReintentos(topic, seq),
    });
  }

  const { H, noResueltas } = clasificarRetenidas(resultadosRetenidas);
  quitarNoResueltas(recibidasPorRemitente, noResueltas);

  // Manifiesto: se chequea UNA vez, al final, y sólo si se leyó hasta el
  // fondo (`chequearManifiestos`, T-192 Task 4 — spec §7/§8 C5(c)/C6).
  if (completo && manifiestos.length > 0) {
    await chequearManifiestos(
      groupId, currentUserId, deviceId, topic, key, record, manifiestos, recibidasPorRemitente, noResueltas,
    );
  }

  // Refresco de claves de autor FUERA DE BANDA (T-041 · S4), sin `await`.
  void refreshPendingAuthors();

  const base = salidaTemprana ? salidaTemprana.cursor : cursor;
  return {
    ok: true, applied, skipped,
    cursor: cursorFinal(base, H),
    completo: completoFinal(completo, H),
  };
}
