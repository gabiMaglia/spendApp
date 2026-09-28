import type { SyncDelta } from './applyDelta';
import { openEnvelope, deriveTopic, type GroupKey } from './envelopeCrypto';
import { fetchSince } from './relay';
import { groupKeyBytes, useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { verifyEnvelope } from './envelopeSign';
import { observeAuthor, RECHAZAR_AUTORES_NO_VERIFICADOS } from './authorHealth';
import { refreshPendingAuthors } from './authorKeys';
import { isManifest, looksLikeManifest, digestOfJson, type SliceManifest } from './manifest';
import { recordManifestCheck } from './manifestHealth';
import { fetchAvatarIfMissing } from './avatarTopic';
import { registrarFalloDeAplicacion, agotoReintentos } from './drainFailures';
import { recordError } from '@/src/services/errorLog';
import { cederHilo } from './cederHilo';
import * as adaptador from './relay/adaptadorHushSplit';
import * as appliedSlices from './relay/appliedSlices';
import { permite as permiteRelectura } from './relay/relecturas';

// T-192 (Task 2, en curso): la publicación (payload + envío por cubos) salió
// a `relay/publicar.ts`. Se re-exporta para que la ruta pública
// `@/src/sync/relaySync` no cambie. El drenaje (`drainGroup` y todo lo que
// usa) sigue acá — sale en las próximas tareas de T-192.
export {
  buildGroupPayload,
  publishToGroup,
  deleteMyGroupEnvelopes,
  type PublishResult,
  PUBLICACION_TIMEOUT_MS,
} from './relay/publicar';

export type DrainResult =
  | {
      ok: true; applied: number; skipped: number; cursor: number;
      /**
       * `true` = el buzón se leyó hasta el final (última página corta). `false`
       * = quedó algo por delante del cursor: una página más, o una rebanada que
       * falló y se va a volver a pedir. Sólo con `true` se puede limpiar la
       * marca de «pendiente de drenaje» (T-089); con `false` el grupo espera a
       * la próxima vuelta. Nada se pierde: se posterga.
       */
      completo: boolean;
    }
  | { ok: false; reason: 'no_key' | 'not_configured' | 'network' | 'key_changed'; detail?: string };

/**
 * ¿La clave del grupo sigue siendo la de la foto? Compara material Y época.
 *
 * T-136 · D-1: un drenaje captura la clave al empezar y espera la red. Si en
 * ese `await` el usuario eligió otra clave (`elegirClaveDeGrupo`), lo que vuelve
 * es del topic VIEJO —en disputa, posiblemente del atacante— y no puede
 * tocar el grupo recién purgado ni dar por drenado el topic real.
 */
export function sigueSiendoLaClave(groupId: string, foto: { key: string; epoch: number }): boolean {
  const actual = useGroupKeyStore.getState().getKey(groupId);
  return !!actual && actual.key.toLowerCase() === foto.key.toLowerCase() && actual.epoch === foto.epoch;
}

/**
 * Baja lo pendiente del grupo, lo descifra y lo aplica.
 *
 * `skipped` cuenta los sobres que no se pudieron abrir. NO es un error: en un
 * topic conocido cualquiera puede inyectar basura (limitación del spike, ver
 * `supabase/001_mailbox.sql`), y un sobre de una época anterior tampoco abre.
 * Se saltean y se sigue — frenar la cola por un sobre ajeno sería un DoS
 * trivial contra el grupo.
 *
 * **Desde T-146 son tres cosas más:** (1) se pagina hasta una página corta,
 * (2) una rebanada que tira en `applyDelta` NO se da por leída — el cursor se
 * devuelve justo antes de ella y la próxima vuelta la vuelve a pedir, hasta
 * `DRAIN_MAX_REINTENTOS` (`drainFailures.ts`) —, y (3) `completo` le dice a
 * `drainNow` si puede limpiar la marca de T-089.
 */

/**
 * Tamaño de página de `fetchSince`. Exportado para que el test lo fije.
 * Antes era la única lectura por drenaje: con K+1 sobres por dispositivo y
 * las huérfanas que dejaba la `ckey` por `seedId`, 200 se alcanzaba, y la
 * marca de T-089 se limpiaba igual (TEC-02).
 */
export const DRAIN_FETCH_LIMIT = 200;

/**
 * Techo de páginas por drenaje. 25 × 200 = 5.000 sobres; un buzón más grande
 * que eso es o un ataque de relleno (SEC-03, T-147) o un bug, y en los dos
 * casos lo correcto es aplicar lo leído, devolver `completo: false` y seguir
 * en la próxima vuelta en vez de colgar el hilo.
 */
export const DRAIN_MAX_PAGES = 25;

/** Sólo tests: páginas chicas para ejercitar la paginación sin 200 sobres. */
export type DrainOptions = {
  pageLimit?: number;
  maxPages?: number;
  /**
   * T-158b: se invoca UNA sola vez, justo antes de aplicar la primera página
   * que trae rebanadas de datos — nunca si el buzón está vacío (ninguna
   * página trajo nada que aplicar). Existe para que `drainNow` pueda tomar su
   * "foto previa" (`snapshot`, T-010) de forma perezosa: calcularla es
   * trabajo sobre potencialmente miles de gastos, y la inmensa mayoría de las
   * vueltas de poll no traen un solo sobre nuevo.
   */
  antesDeAplicar?: () => void;
};

/**
 * Acota un delta recibido a `groupId` y lo aplica — compartido entre el
 * primer intento (dentro del loop de páginas) y la reaplicación al final del
 * drenaje (T-191, Task 3, spec §8 C2): mismo camino, para que un descarte
 * por tope o la búsqueda de fotos por referencia se comporten IGUAL las dos
 * veces. Devuelve los descartes de `adaptador.acotar` — quien llama decide
 * qué hacer con `porDependencia` (retener y reintentar, o dar por aplicado).
 */
async function aplicarDeltaAcotado(
  groupId: string,
  currentUserId: string,
  delta: SyncDelta,
): Promise<{ porTope: number; porDependencia: number; motivos: string[] }> {
  const { delta: acotado, descartes } = adaptador.acotar(delta, groupId);
  if (descartes.porTope > 0) {
    // Rastro, no aviso al usuario (T-150, SEC-07): no hay nada que la víctima
    // pueda hacer con «un miembro mandó un registro demasiado grande», y sí
    // sirve en el diagnóstico exportado cuando alguien pregunta «¿y mi gasto?».
    recordError({
      message: `sync.registro_descartado n=${descartes.porTope} ${descartes.motivos.slice(0, 5).join(',')}`,
      fatal: false, screen: 'sync',
    });
  }
  adaptador.aplicar(acotado, currentUserId);

  // Fotos por referencia (Task 9): se itera `acotado.users` (YA filtrado),
  // nunca `delta.users` crudo, y el digest a pedir se lee del STORE YA
  // MERGEADO — si esta rebanada perdió el LWW, `acotado` trae el viejo.
  await Promise.all(
    (acotado.users ?? [])
      .filter(u => u.avatarDigest && u.id !== currentUserId)
      .map((u) => {
        const digest = useUserStore.getState().getUserById(u.id)?.avatarDigest;
        return digest ? fetchAvatarIfMissing(groupId, u.id, digest) : Promise.resolve();
      }),
  );

  return descartes;
}

/**
 * Relectura acotada (T-191, Task 3, spec §7/§8 C6): el manifiesto de `sender`
 * declaró una `ckey` que este drenaje no pudo dar por cumplida (no llegó hoy
 * y no estaba en `appliedSlices`). Se relee el topic desde el cursor 0 —el
 * buzón conserva la última versión de cada cubo por emisor (compactación por
 * `(topic, owner, ckey)`), así que un cubo viejo vuelve a estar ahí— y se
 * aplica cualquier pieza de `sender` cuya `ckey` siga faltando. El llamador
 * ya verificó con `relecturas.permite` que esto corre A LO SUMO una vez por
 * `(topic, sender, seq del manifiesto)`.
 *
 * Devuelve las `ckey` que SIGUEN faltando después de este intento — pueden
 * quedar si la relectura no encontró el sobre (se perdió de verdad), si
 * seguía teniendo descartes por dependencia, o si la red falló a mitad de
 * camino.
 */
async function releerFaltantes(
  groupId: string,
  currentUserId: string,
  deviceId: string,
  topic: string,
  key: GroupKey,
  record: { key: string; epoch: number },
  sender: string,
  faltantes: { ckey: string; digest: string }[],
): Promise<string[]> {
  const declarados = new Map(faltantes.map(f => [f.ckey, f.digest]));
  const pendientes = new Set(faltantes.map(f => f.ckey));
  let cursor = 0;

  for (let pagina = 0; pagina < DRAIN_MAX_PAGES && pendientes.size > 0; pagina++) {
    const r = await fetchSince(topic, cursor, deviceId, DRAIN_FETCH_LIMIT);
    if (!r.ok) break; // sin red: queda faltante, se reintenta con el próximo manifiesto
    if (!sigueSiendoLaClave(groupId, record)) break;

    for (const envelope of r.envelopes) {
      if (envelope.sender !== sender || !envelope.ckey || !pendientes.has(envelope.ckey)) continue;

      const firmado = verifyEnvelope(envelope.payload);
      if (!firmado) continue;
      const plain = openEnvelope(key, firmado.sealed);
      if (plain === null) continue;

      let parsed: unknown;
      try { parsed = JSON.parse(plain); } catch { continue; }
      if (isManifest(parsed) || looksLikeManifest(parsed)) continue; // esta ckey es de datos

      // Fix 4 (heredado de T-146): el contenido tiene que coincidir con el
      // digest que el manifiesto declaró para esta ckey — un sobre corrupto
      // o una versión equivocada bajo la misma ckey NUNCA se acepta como
      // "encontrado" sólo porque decodificó. Si no coincide, sigue faltante.
      const digest = await digestOfJson(plain);
      if (digest !== declarados.get(envelope.ckey)) continue;

      try {
        const descartes = await aplicarDeltaAcotado(groupId, currentUserId, parsed as SyncDelta);
        if (descartes.porDependencia === 0) {
          appliedSlices.registrar(adaptador.almacen, topic, sender, envelope.ckey, {
            digest, seq: envelope.seq, senderKey: firmado.senderKey,
          });
          pendientes.delete(envelope.ckey);
        }
      } catch (e) {
        registrarFalloDeAplicacion(topic, envelope.seq, e);
      }
    }

    cursor = r.cursor;
    const hayMas = r.more ?? r.envelopes.length >= DRAIN_FETCH_LIMIT;
    if (!hayMas) break;
  }

  return [...pendientes];
}

export async function drainGroup(
  groupId: string,
  currentUserId: string,
  deviceId: string,
  sinceSeq: number,
  opts: DrainOptions = {},
): Promise<DrainResult> {
  const pageLimit = opts.pageLimit ?? DRAIN_FETCH_LIMIT;
  const maxPages = opts.maxPages ?? DRAIN_MAX_PAGES;

  // Verifier ciego (B3): foto de la SESIÓN ACTIVA al arrancar — no se compara
  // contra `currentUserId` (ese es el id de atribución del merge, que un
  // llamador puede legítimamente pasar distinto de la sesión activa, p. ej.
  // para aplicar en nombre de otro id en un test o en un camino de fusión de
  // cuentas) sino contra sí misma más abajo, justo antes de aplicar: lo que
  // importa es si la sesión CAMBIÓ durante el drenaje, no si coincide con
  // este parámetro puntual.
  const sesionAlArrancar = useAuthStore.getState().currentUser?.id ?? null;

  const key = groupKeyBytes(groupId);
  if (!key) return { ok: false, reason: 'no_key' };

  const record = useGroupKeyStore.getState().getKey(groupId)!;
  const topic = await deriveTopic(key, record.epoch);

  let cursor = sinceSeq;
  let applied = 0;
  let skipped = 0;
  let completo = false;

  // Lo que el chequeo de manifiesto necesita ver ENTERO, acumulado a través de
  // las páginas: qué rebanadas llegaron de cada remitente (con su JSON, para
  // recalcular el digest) y qué manifiestos. Un manifiesto puede caer en una
  // página y sus rebanadas en otra.
  const recibidasPorRemitente = new Map<string, Map<string, string>>();
  const manifiestos: { sender: string; manifest: SliceManifest; senderKey: string; seq: number }[] = [];
  let seLlamoAntesDeAplicar = false;

  // T-191 (Task 3, spec §8 C2): rebanadas que se aplicaron pero dejaron
  // descartes POR DEPENDENCIA (comentario sin su gasto todavía local, perfil
  // de un usuario que todavía no es miembro local) — se reintentan al final
  // del drenaje, después de la última página, cuando `groups`/`expenses` de
  // esta misma tanda de publicaciones ya tuvieron chance de llegar por su
  // propio cubo. Sólo entonces se registran en `appliedSlices`.
  const retenidasPorDependencia: { seq: number; ckey?: string; sender: string; delta: SyncDelta; senderKey: string; json: string }[] = [];

  // V2 (verifier, segunda tanda): un fallo de aplicación con reintentos
  // agotados devolvía ANTES `return {...}` directo desde dentro del loop —
  // eso saltaba ENTERO el paso de abajo que reaplica `retenidasPorDependencia`
  // (líneas más abajo) y el chequeo de manifiesto. Una rebanada retenida por
  // dependencia en una página anterior de ESTA MISMA llamada se perdía sin
  // dejar rastro: el cursor ya había avanzado más allá de ella y nunca se
  // volvía a pedir. Ahora ese caso guarda el resultado acá y **rompe los dos
  // loops** (`paginas:` abajo) en vez de retornar — la reaplicación de
  // retenidas SIEMPRE corre antes de devolver, la haya pedido este camino o
  // el normal. El chequeo de manifiesto sigue sin correr (`completo` queda
  // `false`, como antes): esta salida es parcial a propósito.
  let salidaTemprana: { cursor: number } | null = null;
  // V2b (arquitecto, tercera ronda — spec §8 C2): distingue el corte de red
  // en una página POSTERIOR (no cobra cupo a las retenidas, ajuste A) del
  // tope de páginas alcanzado (si cobra). Ninguno de los dos es "completo".
  let corteDeRed = false;

  paginas: for (let pagina = 0; pagina < maxPages; pagina++) {
    const r = await fetchSince(topic, cursor, deviceId, pageLimit);
    if (!r.ok) {
      // Sin red en la primera página es un drenaje fallido. En una página
      // posterior ya hay cosas aplicadas: se devuelve hasta dónde se llegó, y
      // `completo: false` deja la marca de T-089 puesta.
      if (pagina === 0) return { ok: false, reason: r.reason, detail: r.detail };
      corteDeRed = true;
      break;
    }

    // T-136 · D-1: la clave cambió mientras se esperaba la red. El lote entero
    // se descarta ANTES de abrir un solo sobre: nada se aplica y quien llama
    // no avanza el cursor ni limpia la marca de pendiente.
    if (!sigueSiendoLaClave(groupId, record)) return { ok: false, reason: 'key_changed' };

    // Con ADR-007 lo que llega ya no es "un delta por sobre": son rebanadas de
    // datos MÁS, en cualquier posición del lote, uno o más sobres de manifiesto
    // (Task 5/`buildSlicedEnvelopes`). Por eso cada página son DOS pasadas:
    //
    //  1. Colección: abrir y descifrar cada sobre, y separar manifiestos de
    //     rebanadas de datos — sin aplicar nada todavía.
    //  2. Aplicación: recorrer las rebanadas de datos EN EL MISMO ORDEN en que
    //     se recibieron (`seq` ascendente, tal cual las entrega `fetchSince`).
    //     Este orden es load-bearing — ver el comentario sobre `SLICED_FIELDS`
    //     más arriba: `users` y `comments` dependen de que `groups`/`expenses`
    //     de la MISMA publicación ya se hayan aplicado. Reordenar acá rompería
    //     esa garantía; paginar no la toca porque `seq` es global al topic.
    const rebanadas: { seq: number; ckey?: string; sender: string; delta: SyncDelta; senderKey: string; json: string }[] = [];

    for (let i = 0; i < r.envelopes.length; i++) {
      // T-157b: cede el hilo ENTRE aperturas, nunca antes de la primera —
      // sólo en esta pasada (colección: verificar firma + descifrar). La
      // pasada de APLICACIÓN (abajo) no llama a `cederHilo()` ENTRE piezas
      // —eso sí rompería el orden load-bearing de `SLICED_FIELDS`, que exige
      // que `groups`/`expenses` de la MISMA publicación ya estén aplicados
      // antes de `users`/`comments`—, pero **no es código síncrono de punta a
      // punta**: verifier ciego (B3), corrección sobre una afirmación falsa
      // de una revisión anterior. `observeAuthor` (abajo) es una llamada real
      // con su propio `await`, y `fetchAvatarIfMissing` (más abajo, dentro
      // del mismo bloque) también. Por eso el rechequeo de `sigueSiendoLaClave`
      // y del usuario activo, justo antes de `antesDeAplicar`, no es
      // paranoia: el hueco que abre `cederHilo()` acá arriba es el mismo tipo
      // de ventana que esos otros `await`, sólo que más ancha.
      if (i > 0) await cederHilo();
      const envelope = r.envelopes[i]!;
      // 1. Firma. Descarta lo ajeno ANTES de gastar una operación de cifrado.
      const firmado = verifyEnvelope(envelope.payload);
      if (firmado === null) { skipped++; continue; }

      // 2. Cifrado. Sin la clave del grupo no se lee nada, firme quien firme.
      const plain = openEnvelope(key, firmado.sealed);
      if (plain === null) { skipped++; continue; }

      let parsed: unknown;
      try {
        parsed = JSON.parse(plain);
      } catch {
        skipped++; // descifró pero el JSON no era válido
        continue;
      }

      if (isManifest(parsed)) {
        manifiestos.push({
          sender: envelope.sender, manifest: parsed,
          senderKey: firmado.senderKey, seq: envelope.seq,
        });
        continue;
      }

      // T-146, ronda 2 del verifier (D3): `looksLikeManifest` sólo mira
      // `version`/`entries`, `isManifest` ya validó también cada entrada —
      // si pasó lo primero y no lo segundo, es un manifiesto ROTO (entrada
      // no-objeto, o `ckey`/`digest` que no son `string`). Antes esto se
      // colaba como manifiesto válido y el chequeo final, después del loop
      // de rebanadas y fuera de cualquier `try`, tiraba con `entry.ckey`.
      // Se descarta acá, con rastro, y nunca llega a ese chequeo ni se
      // procesa como si fuera una rebanada de datos (no lo es).
      if (looksLikeManifest(parsed)) {
        skipped++;
        registrarFalloDeAplicacion(topic, envelope.seq, new Error('manifest_malformado'));
        continue;
      }

      // `senderKey` viaja por sobre, no por delta: se guarda acá para la
      // segunda pasada. `json` es el plano post-descifrado, pre-parse: hace
      // falta para recalcular el digest contra el manifiesto.
      rebanadas.push({
        seq: envelope.seq,
        ckey: envelope.ckey,
        sender: envelope.sender,
        delta: parsed as SyncDelta,
        senderKey: firmado.senderKey,
        json: plain,
      });

      if (envelope.ckey) {
        let mapa = recibidasPorRemitente.get(envelope.sender);
        if (!mapa) {
          mapa = new Map();
          recibidasPorRemitente.set(envelope.sender, mapa);
        }
        mapa.set(envelope.ckey, plain);
      }
    }

    // Verifier ciego (B3): rechequeo justo antes de aplicar. El chequeo de
    // `sigueSiendoLaClave` de más arriba corrió ANTES de abrir un solo sobre
    // de esta página — pero la pasada de colección que acaba de terminar
    // cedió el hilo varias veces (`cederHilo`, T-157b), y en ese hueco puede
    // haber pasado un logout, un wipe de cuenta o un cambio de clave de
    // grupo. Aplicar la caché que se armó ANTES de eso, sobre stores que
    // mientras tanto se vaciaron, resucita datos de la cuenta anterior en la
    // cuenta nueva. Si algo cambió, esta página se aborta ENTERA — no se
    // aplica nada de ella ni se mueve el cursor (mismo criterio que el
    // chequeo de arriba): la próxima vuelta, ya con el contexto correcto,
    // la vuelve a pedir desde `sinceSeq`.
    if (rebanadas.length > 0) {
      const sesionSigueSiendoLaMisma = (useAuthStore.getState().currentUser?.id ?? null) === sesionAlArrancar;
      if (!sesionSigueSiendoLaMisma || !sigueSiendoLaClave(groupId, record)) {
        return { ok: false, reason: 'key_changed' };
      }
    }

    // T-158b: la foto previa se toma UNA sola vez, recién acá — después del
    // fetch de esta página, antes de aplicar la primera rebanada de datos que
    // trajo. Una página que sólo trae manifiestos (o sobres que no abrieron)
    // no dispara nada: no hay nada que aplicar todavía.
    if (!seLlamoAntesDeAplicar && rebanadas.length > 0) {
      opts.antesDeAplicar?.();
      seLlamoAntesDeAplicar = true;
    }

    for (const { seq, ckey, sender, delta, senderKey, json } of rebanadas) {
      // Ronda 1 del verifier (D1): TODO lo que puede tirar por esta rebanada —
      // incluida la observación de autoría, que lee `delta.fromUserId` sin
      // haber comprobado que `delta` sea un objeto— tiene que pasar por el
      // MISMO camino de `drainFailures` (reintentos + rastro + skip). Antes
      // `observeAuthor` estaba FUERA de este `try`: un sobre firmado y
      // cifrado con la clave del grupo cuyo texto plano fuera `null` (u otro
      // no-objeto) hacía que `delta.fromUserId` tirara un TypeError que
      // `drainGroup` nunca atajaba — `drainNow` lo veía como un throw crudo,
      // caía en su propio `catch` sin tocar cursor ni marca de T-089, y el
      // presupuesto de 3 reintentos jamás llegaba a consumirse.
      try {
        // 3. Autoría (ADR-004 fase B/T-033). Con `RECHAZAR_AUTORES_NO_VERIFICADOS`
        // apagado (default), esto sigue siendo modo AVISO: se mide, nunca se
        // descarta. Prendido, sólo un veredicto `clave_desconocida` descarta el
        // registro — nunca `sin_directorio` (rechazar ahí sería tratar "no sé"
        // como "es malo"). Por eso se espera el veredicto antes de aplicar.
        const veredicto = await observeAuthor(groupId, delta.fromUserId, senderKey);
        if (RECHAZAR_AUTORES_NO_VERIFICADOS && veredicto === 'clave_desconocida') {
          skipped++;
          continue;
        }

        // S3-A1: la firma y el cifrado sólo prueban quién lo mandó y que tiene
        // la clave del TOPIC — nunca acotan qué puede venir adentro. Se arma un
        // delta nuevo, campo por campo, con sólo lo que pertenece a `groupId`
        // antes de tocar cualquier store (`adaptador.acotar`, T-191 Task 0 —
        // hoy `acotarDeltaAlGrupo`).
        const descartes = await aplicarDeltaAcotado(groupId, currentUserId, delta);
        applied++;

        if (descartes.porDependencia > 0) {
          // T-191 (Task 3, spec §8 C2): esta rebanada perdió algo por
          // dependencia (comentario sin su gasto todavía local, usuario no
          // miembro todavía) — se retiene para reaplicar al final del
          // drenaje, cuando `groups`/`expenses` de la MISMA tanda ya tuvieron
          // chance de llegar (posiblemente en otra página). Recién si esa
          // reaplicación queda sin descartes por dependencia se registra en
          // `appliedSlices` — mientras tanto, un manifiesto que la declare
          // «falta» está en lo cierto, y eso es lo que dispara la relectura
          // (C6) si esta misma vuelta no alcanza a resolverla.
          retenidasPorDependencia.push({ seq, ckey, sender, delta, senderKey, json });
        } else if (ckey) {
          appliedSlices.registrar(adaptador.almacen, topic, sender, ckey, {
            digest: await digestOfJson(json), seq, senderKey,
          });
        }
      } catch (e) {
        // TEC-01: antes esto era `catch { skipped++ }` y el cursor avanzaba
        // igual — la rebanada no volvía a pedirse hasta que su emisor la
        // republicara. Ahora se anota y, mientras quede presupuesto, se
        // devuelve el cursor JUSTO ANTES de ella para que la próxima vuelta la
        // vuelva a pedir. Agotado el presupuesto, se deja atrás con rastro.
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
    // T-147 (D4): `fetch_since` puede cortar por BYTES (tope de 4 MB), no sólo
    // por cantidad de filas — una página puede traer menos de `pageLimit`
    // sobres y aun así avisar `more = true`. Con un servidor viejo que no
    // manda `more`, se conserva la regla de siempre: página corta = fondo.
    const hayMas = r.more ?? r.envelopes.length >= pageLimit;
    if (!hayMas) {
      completo = true;
      break;
    }
  }

  // V2b (arquitecto, tercera ronda — spec §8 C2): reaplicar al final lo que
  // quedó retenido por dependencia en CUALQUIER página. Si queda SIN
  // descartes, se registra en `appliedSlices`. Si sigue con descartes (o la
  // reaplicación tira), entra en `noResueltas` — y en `H` sólo si TODAVÍA
  // tiene cupo en `drainFailures` (`(topic, seq)`). El cupo se cobra
  // (ajuste A) sólo cuando este drenaje llega al fondo del buzón o al tope
  // de páginas — NUNCA en una salida temprana ni en un corte de red: en esos
  // dos casos la retenida ni tuvo la última chance real de resolverse hoy.
  const debeCobrarCupo = !salidaTemprana && !corteDeRed;
  const H: { seq: number; ckey?: string; sender: string }[] = [];
  const noResueltas: { sender: string; ckey?: string }[] = [];

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

    if (siguePendiente) {
      noResueltas.push({ sender, ckey });
      // Cupo agotado: sale de `H` (no bloquea el cursor) — el manifiesto la
      // marca faltante igual (ajuste B, más abajo), como cualquier otro
      // faltante permanente.
      if (!agotoReintentos(topic, seq)) H.push({ seq, ckey, sender });
    }
  }

  // Ajuste B: una retenida NO RESUELTA se saca de `recibidasPorRemitente`
  // ANTES del chequeo de manifiesto — `entradaCumplida` la daría por
  // cumplida sólo porque el sobre LLEGÓ, sin mirar si de verdad terminó de
  // aplicarse. Con o sin cupo: las dos formas de "no resuelta" tienen que
  // seguir figurando como faltantes para `manifestHealth`.
  for (const { sender, ckey } of noResueltas) {
    if (ckey) recibidasPorRemitente.get(sender)?.delete(ckey);
  }

  // Manifiesto: se chequea UNA vez, al final, y sólo si se leyó hasta el
  // fondo. Con una página recortada por delante, el manifiesto o sus rebanadas
  // pueden estar ahí y un gap acá sería un falso positivo sin mitigación. Se
  // prefiere no decir nada a mentir. Un gap NUNCA descarta ni deja de aplicar
  // rebanadas que sí llegaron: sólo se REGISTRA para avisar en la UI.
  //
  // Por remitente: el servidor compacta por topic + prenda + ckey, o sea por
  // dispositivo — el manifiesto de A sólo se completa con rebanadas de A.
  //
  // T-191 (Task 3, spec §7/§8 C5(c)): una entrada se da por cumplida si
  // llegó EN ESTE drenaje con el digest declarado, o si ya estaba en
  // `appliedSlices` (mismo digest, o `seq` mayor — publicación en curso
  // cortada por la cuota) con la MISMA `senderKey` que firmó el manifiesto.
  // Antes de T-191 (publicación siempre completa) esto no hacía falta: todo
  // lo que el manifiesto declaraba SIEMPRE viajaba en la misma tanda.
  if (completo && manifiestos.length > 0) {
    // T-146, ronda 2 del verifier (D3): `isManifest` ya valida cada entrada,
    // así que `entry.ckey`/`entry.digest` deberían ser siempre `string` acá.
    // Aun así, este bloque queda envuelto: nada de lo que corre DESPUÉS de
    // abrir sobres —ni siquiera un chequeo que hoy es seguro— puede volver a
    // tirar fuera del manejo con rastro. Si algo tira igual (p.ej. la
    // librería de digest), se anota y el drenaje TERMINA igual: `applied`,
    // `skipped` y `cursor` de las rebanadas ya procesadas no se pierden.
    try {
      const faltantesTotales: string[] = [];
      for (const { sender, manifest, senderKey: senderKeyManifiesto, seq: seqManifiesto } of manifiestos) {
        const recibidas = recibidasPorRemitente.get(sender) ?? new Map<string, string>();
        let faltantes: { ckey: string; digest: string }[] = [];
        for (const entry of manifest.entries) {
          const json = recibidas.get(entry.ckey);
          const digestRecibido = json !== undefined ? await digestOfJson(json) : undefined;
          const aplicada = appliedSlices.leer(adaptador.almacen, topic, sender, entry.ckey);
          if (!appliedSlices.entradaCumplida(entry, seqManifiesto, senderKeyManifiesto, digestRecibido, aplicada)) {
            faltantes.push(entry);
          }
        }

        // Ajuste C (V2b, arquitecto): una ckey retenida sin resolver NO
        // dispara relectura — el sobre ya está en mano, releerlo de nuevo no
        // cambia nada (el problema es la dependencia, no el transporte). Si
        // TODOS los faltantes de este emisor son retenidas, se conserva el
        // cupo de relectura (`permiteRelectura` no se consulta) — pero
        // igual cuentan como faltantes más abajo, para `manifestHealth`.
        const ckeysNoResueltasDeEsteSender = new Set(
          noResueltas.filter(n => n.sender === sender && n.ckey).map(n => n.ckey!),
        );
        const todosSonRetenidas = faltantes.length > 0
          && faltantes.every(f => ckeysNoResueltasDeEsteSender.has(f.ckey));

        // T-191 (Task 3, spec §7/§8 C6): faltó algo — como MUCHO una
        // relectura desde el cursor 0 por `(topic, sender, seq del
        // manifiesto)`. Si después de releer sigue faltando, se registra y
        // no se vuelve a intentar hasta que llegue un manifiesto con otro
        // `seq` (`relecturas.permite` no vuelve a dar `true` para esta terna).
        if (faltantes.length > 0 && !todosSonRetenidas && permiteRelectura(topic, sender, seqManifiesto)) {
          const siguenFaltando = await releerFaltantes(
            groupId, currentUserId, deviceId, topic, key, record, sender, faltantes,
          );
          faltantes = faltantes.filter(f => siguenFaltando.includes(f.ckey));
        }
        faltantesTotales.push(...faltantes.map(f => f.ckey));
      }
      recordManifestCheck(groupId, faltantesTotales);
    } catch (e) {
      recordError({
        message: `sync.manifest_check_failed topic=${topic.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`,
        stack: e instanceof Error ? e.stack : undefined,
        fatal: false,
        screen: 'sync',
      });
    }
  }

  // Refresco de claves de autor FUERA DE BANDA (T-041 · S4), sin `await`: lo
  // que aprenda sirve para la próxima vuelta.
  void refreshPendingAuthors();

  // V2b (arquitecto, tercera ronda — spec §8 C2): el cursor NUNCA pasa una
  // retenida por dependencia que siga sin resolver Y con cupo — `base` es
  // el cursor que este drenaje habría devuelto de no haber retenidas
  // (`salidaTemprana.cursor` si la hubo, si no el último `r.cursor`); si
  // `H` no está vacío, el cursor se recorta a justo ANTES de la más vieja
  // de ellas, para que la próxima vuelta la vuelva a pedir. `completo`
  // (original, sólo se puso en `true` en la lectura natural hasta el fondo)
  // se apaga si queda algo en `H` — invariante: `cursor >= sinceSeq` siempre
  // (la retenida más vieja nunca es anterior a `sinceSeq`, porque `H` sólo
  // contiene rebanadas que este mismo drenaje leyó).
  const base = salidaTemprana ? salidaTemprana.cursor : cursor;
  const minHSeq = H.length > 0 ? Math.min(...H.map(h => h.seq)) : undefined;
  const cursorFinal = minHSeq !== undefined ? Math.min(base, minHSeq - 1) : base;
  const completoFinal = completo && H.length === 0;

  return { ok: true, applied, skipped, cursor: cursorFinal, completo: completoFinal };
}
