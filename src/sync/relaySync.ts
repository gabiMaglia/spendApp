import { buildDelta, applyDelta, type SyncDelta } from './useSyncQR';
import { acotarDeltaAlGrupo } from './acotarDeltaAlGrupo';
import { sealEnvelope, openEnvelope, deriveTopic, type GroupKey } from './envelopeCrypto';
import { sendEnvelope, fetchSince, deleteMyEnvelopes, type DeleteResult } from './relay';
import { groupKeyBytes, useGroupKeyStore } from '@/src/store/groupKeyStore';
import { ensureIdentity } from '@/src/store/identityStore';
import { signEnvelope, verifyEnvelope } from './envelopeSign';
import { observeAuthor, RECHAZAR_AUTORES_NO_VERIFICADOS } from './authorHealth';
import { refreshPendingAuthors } from './authorKeys';
import { sliceEntities, deriveCkey } from './slices';
import { buildManifest, digestOfJson, isManifest, looksLikeManifest, type SliceManifest } from './manifest';
import { recordManifestCheck } from './manifestHealth';
import { recordSlicePublished } from './sliceRenewal';
import { publishAvatarIfOwn, fetchAvatarIfMissing } from './avatarTopic';
import { useUserStore } from '@/src/store/userStore';
import { registrarFalloDeAplicacion, agotoReintentos } from './drainFailures';
import { recordError } from '@/src/services/errorLog';

/**
 * Sync por el relay: arma el sobre cifrado, lo publica y aplica lo que llega.
 *
 * Es la unión de las tres piezas anteriores — buzón (`relay.ts`), cerradura
 * (`envelopeCrypto.ts`) y merge LWW (`useSyncQR.ts`) — con una regla que manda
 * sobre todo lo demás:
 *
 * **Por el relay NUNCA viaja una clave de grupo.** El delta del pairing QR sí
 * las lleva, porque ese canal está autenticado por presencia física. Éste no.
 * Si el relay pudiera entregar claves, podría sustituirlas y leer todo — es el
 * punto exacto donde estas arquitecturas se rompen (ADR-003 §1). Por eso el
 * payload se arma acá y no se reusa `buildDelta` tal cual.
 */

/**
 * Payload del relay: **sólo lo del grupo al que se publica**.
 *
 * Antes esto mandaba el delta entero menos las claves — o sea TODO el
 * dispositivo, cifrado con la clave de UN grupo. Cualquier miembro de ese grupo
 * podía abrirlo y quedarse con los otros grupos, sus gastos y los movimientos
 * personales de quien publicaba. Con dos cuentas del mismo dueño era invisible;
 * con gente real era una filtración, e imposible de revertir una vez que el
 * dato aterrizó en otro teléfono.
 *
 * Filtrar por grupo es además lo que baja el tamaño: el sobre pasa a ser una
 * fracción, y el techo de 256KB deja de estar a la vuelta de la esquina.
 *
 * Este objeto se arma campo por campo, no quitando lo prohibido. Es lo contrario
 * de lo que hacía antes, y es a propósito: no existe un filtro genérico "lo de
 * este grupo" — cada entidad se relaciona con el grupo de una forma distinta
 * (los comentarios cuelgan del gasto, los usuarios de la membresía). Enumerar
 * obliga a decidir. Para que agregar una entidad nueva no se olvide EN SILENCIO,
 * `relayScope.test.ts` compara las claves del delta contra esta lista y falla si
 * aparece una que nadie clasificó.
 */
export function buildGroupPayload(groupId: string, currentUserId: string): SyncDelta {
  const completo = buildDelta(currentUserId);

  const delGrupo = completo.groups.filter(g => g.id === groupId);
  const miembros = new Set(delGrupo[0]?.memberIds ?? []);

  const expenses = completo.expenses.filter(e => e.groupId === groupId);
  const idsDeGastos = new Set(expenses.map(e => e.id));

  return {
    version: completo.version,
    featureVersion: completo.featureVersion,
    fromUserId: completo.fromUserId,
    timestamp: completo.timestamp,

    groups: delGrupo,
    expenses,
    payments: completo.payments.filter(p => p.groupId === groupId),
    // Los perfiles de los miembros SÍ hacen falta: sin ellos el otro ve ids en
    // vez de nombres. Los de gente ajena al grupo, no.
    //
    // El email SÍ se saca (T-093 ronda 2 / R-2, hallazgo del verificador ciego):
    // `completo.users` trae el registro ENTERO de cada uno —incluido el propio,
    // que `session.ts` persiste con el mail real de OAuth al loguear— y filtrar
    // por `miembros` sólo decide QUÉ FILAS viajan, nunca qué CAMPOS. El mail
    // viajaba tal cual a cualquiera que compartiera el grupo, y ningún receptor
    // lo lee (sólo se muestra `currentUser.email`, la cuenta propia, en
    // `user.tsx`/`debug/identity.tsx`; nunca el de otro usuario). Es lo que
    // `plans/T-077.md` ya declaraba cierto ("Mail: NO recolectado") sin serlo:
    // esto lo hace cierto, no cambia la fila de Data Safety.
    users: completo.users.filter(u => miembros.has(u.id)).map(u => ({ ...u, email: '' })),
    recurring: (completo.recurring ?? []).filter(r => r.groupId === groupId),
    // Un comentario no sabe de qué grupo es: cuelga del gasto.
    comments: (completo.comments ?? []).filter(c => idsDeGastos.has(c.expenseId)),

    // `personal` NO viaja: son movimientos sin grupo, de nadie más que su dueño.
    // `groupKeys` tampoco: si el relay pudiera entregar claves podría
    // sustituirlas y leer todo (ADR-003 §1).
  };
}

/**
 * Campos de `SyncDelta` que se parten en rebanadas. `personal` y `groupKeys`
 * nunca aparecen en un payload de grupo (`buildGroupPayload` ya los excluye,
 * ver comentario ahí) así que no hace falta clasificarlos acá.
 *
 * **EL ORDEN DE ESTE ARRAY ES INVARIANTE, NO UN DETALLE ESTÉTICO.** Los
 * sobres se mandan y se drenan en este mismo orden (`buildSlicedEnvelopes` /
 * `drainGroup` procesan en `seq`), y `acotarDeltaAlGrupo` filtra `users` y
 * `comments` contra estado que se asume YA LOCAL:
 *  - `users` se filtra contra `local.groupMemberIds(groupId)` — necesita que
 *    el sobre de `groups` ya se haya aplicado.
 *  - `comments` sólo sobrevive si su `expenseId` está en el sobre de
 *    `expenses` **o ya es local** — necesita que `expenses` haya sido
 *    aplicado antes.
 * `groups` y `expenses` van primero a propósito. Si alguien reordena este
 * array (o cambia el drenaje para no respetar `seq`), un miembro nuevo puede
 * perder comentarios y perfiles en su primer sync **en silencio** — no hay
 * error, sólo datos que nunca llegan. Ver el JSDoc de `buildSlicedEnvelopes`
 * para el detalle de qué garantiza y qué no cada sobre.
 */
const SLICED_FIELDS = ['groups', 'expenses', 'payments', 'users', 'recurring', 'comments'] as const;

/**
 * Parte el `SyncDelta` completo de un grupo en rebanadas —una por sub-lote de
 * cada tipo de entidad, vía `sliceEntities` (ADR-007)— más UN sobre de
 * manifiesto al final, que declara la `ckey` y el digest de cada rebanada
 * (`buildManifest`, Task 3).
 *
 * Cada rebanada es un `SyncDelta` válido por derecho propio: sólo trae la
 * porción de UN campo, todos los demás campos sliceables van vacíos. Cada
 * sobre se puede ABRIR y DESCIFRAR de forma independiente, sin esperar a que
 * lleguen los demás — pero **aplicarlo correctamente es otra cosa**: no es
 * cierto para todos los campos que mergearlo no dependa de qué otros sobres ya
 * se aplicaron. `acotarDeltaAlGrupo` filtra `users` contra la membresía local
 * del grupo y `comments` contra el conjunto de `expenses` ya conocidos —
 * ambos asumen que los sobres de `groups`/`expenses` de ESTA MISMA
 * publicación ya se procesaron. Por eso `SLICED_FIELDS` tiene a `groups` y
 * `expenses` antes de `users` y `comments`, y por eso ese orden es
 * load-bearing (ver el comentario sobre `SLICED_FIELDS` más abajo) — el
 * drenaje (`drainGroup`) tiene que respetar el orden de envío (`seq`) para
 * que esta garantía se sostenga.
 *
 * El manifiesto se manda AL FINAL a propósito: es el sobre que un lector
 * necesita ver para saber "esto es todo lo que hay", y por eso su `seq` es el
 * que identifica la publicación completa (ver `publishToGroup`).
 */
async function buildSlicedEnvelopes(
  delta: SyncDelta,
  key: GroupKey,
  groupId: string,
  deviceId: string,
): Promise<{ ckey: string; json: string }[]> {
  const piezas: { ckey: string; json: string }[] = [];

  // Fotos por referencia (Task 9): `users` se trata aparte, ANTES del loop de
  // `SLICED_FIELDS`, para reemplazar los bytes de `avatar` por un
  // `avatarDigest` — la foto real viaja en su propio topic (`avatarTopic.ts`),
  // no en cada publicación de la rebanada `users`.
  //
  // El campo se elide con `undefined` (ausencia), NUNCA con `null`:
  // `preservarAvatar` (`userAvatar.ts`) trata `avatar: null` como tombstone
  // real («esta persona se sacó la foto») y adopta el registro entrante tal
  // cual, borrando lo que el receptor ya tenía cacheado. `undefined` en
  // cambio es exactamente la rama que esa función ya sabía resolver: "no
  // traigo info, conservá lo que tenías" — que es lo que se quiere acá,
  // porque la foto sigue siendo la misma, sólo que no viaja en este sobre.
  //
  // Precondición de flota (hallazgo #5 de la revisión de Task 9): esta
  // elisión sólo es segura porque `preservarAvatar` ("fase A", T-056) ya
  // resuelve `undefined` como "conservar" en vez de "borrar" — ver el
  // docblock de `src/store/userAvatar.ts`, que documenta esto explícitamente
  // como precondición de la fase B (no reenviar avatares ajenos). Un
  // dispositivo que TODAVÍA corriera la lógica de merge anterior a esa fase
  // vería el `avatar` ausente y se borraría su copia cacheada. Se asume que
  // fase A ya está desplegada en toda la flota; si se descubre que no lo
  // está, hay que revertir esta elisión hasta confirmarlo.
  // Revisión final, hallazgo crítico (Fix 2): el digest sólo se RECALCULA para
  // el propio registro (`u.id === delta.fromUserId`). Antes se recalculaba
  // para CUALQUIER usuario con `avatar` cacheado localmente — incluidos otros
  // miembros. Ese cálculo usa la copia local de ESTE dispositivo, que puede
  // estar vieja: si este aparato tiene una foto stale de otro miembro y
  // republica el grupo por cualquier motivo, declararía esa versión vieja
  // como "la" versión, y un tercero que confía en el digest declarado
  // adoptaría esos bytes viejos vía `fetchAvatarIfMissing` → `addOrUpdateUser`
  // — que escribe DIRECTO al store, sin LWW ni chequeo de timestamp — pisando
  // una foto más nueva que ya tenía. Un dispositivo sólo puede asegurar
  // frescura sobre SU PROPIA foto; para cualquier otro registro, el
  // `avatarDigest` que ya trae la fila local (puesto por un merge anterior)
  // se deja tal cual, nunca se toca.
  const usuariosConDigest = await Promise.all(
    (delta.users ?? []).map(async (u) => {
      if (u.id !== delta.fromUserId) {
        if (!u.avatar) return u; // sin foto cacheada: nada que elidir
        // No es mi registro: se elide el blob (nunca se reenvían fotos ajenas
        // completas) pero `avatarDigest` queda EXACTAMENTE como ya estaba en
        // la fila local — nunca se recalcula a partir de bytes cacheados de
        // otro usuario.
        const { avatar: _avatarAjeno, ...sinFotoAjena } = u;
        return sinFotoAjena;
      }
      if (!u.avatar) return u; // propio, sin foto (o tombstone real): nada que referenciar
      const digest = await digestOfJson(u.avatar);
      // Es mi propia foto: la publico (si cambió) en su topic aparte.
      // Se espera acá, no fire-and-forget: si no se espera, nada garantiza
      // que el sobre de la foto exista en el buzón para cuando otro
      // miembro drene esta misma publicación y pida esta rebanada.
      await publishAvatarIfOwn(groupId, delta.fromUserId, deviceId);
      const { avatar: _avatar, ...sinFoto } = u;
      return { ...sinFoto, avatarDigest: digest };
    }),
  );
  const deltaConUsuarios: SyncDelta = { ...delta, users: usuariosConDigest };

  for (const campo of SLICED_FIELDS) {
    const lista = (deltaConUsuarios[campo] ?? []) as { id: string }[];
    const rebanadas = sliceEntities(lista);
    for (let i = 0; i < rebanadas.length; i++) {
      const rebanada = rebanadas[i]!;
      // La ckey va por ÍNDICE de rebanada, no por el primer id (T-146). Con el
      // id, un registro nuevo que ordenaba antes corría todos los límites y
      // re-claveaba cada rebanada siguiente: las viejas quedaban huérfanas en
      // el buzón hasta el TTL de 30 días, una tanda por publicación. Con el
      // índice, la rebanada k de `campo` es siempre la misma ckey y la
      // compactación del servidor la pisa.
      const ckey = await deriveCkey(key, campo, String(i));
      const parcial: SyncDelta = {
        version: delta.version,
        featureVersion: delta.featureVersion,
        fromUserId: delta.fromUserId,
        timestamp: delta.timestamp,
        groups: [], expenses: [], payments: [], users: [],
        [campo]: rebanada,
      } as SyncDelta;
      piezas.push({ ckey, json: JSON.stringify(parcial) });
      // Revisión final (Fix 3): `recordSlicePublished` YA NO se llama acá.
      // Acá sólo se ARMA la lista de piezas — todavía no se mandó nada por la
      // red. Registrar "publicada" en este punto marcaba una rebanada como
      // fresca aunque `publishToGroup` fallara a mitad de camino (p. ej. la
      // red se cae en la rebanada 3 de 5): esa rebanada nunca llegó al buzón,
      // pero el reloj de renovación de 20 días (`sliceRenewal.ts`) ya la daba
      // por publicada, así que el mecanismo de renovación nunca la
      // reintentaría. El registro se movió a `publishToGroup`, después de que
      // `sendEnvelope` confirma `{ok: true}` para esa pieza puntual — mismo
      // patrón que `avatarTopic.ts`'s `publishAvatarIfOwn` ya usa
      // correctamente.
    }
  }

  const manifiesto = await buildManifest(piezas);
  const manifiestoCkey = await deriveCkey(key, 'manifest', 'unica');
  piezas.push({ ckey: manifiestoCkey, json: JSON.stringify(manifiesto) });

  return piezas;
}

export type PublishResult =
  | { ok: true; seq: number }
  /**
   * `pending_drain` (T-089): el grupo todavía no drenó su buzón, así que
   * publicar mandaría un estado que puede resucitar lo que el grupo borró
   * mientras este teléfono estuvo afuera. **No es un fallo**: se resuelve solo
   * en cuanto el drenaje termine, y por eso no es bloqueante.
   */
  | { ok: false; reason: 'no_key' | 'too_large' | 'not_configured' | 'network' | 'pending_drain'; detail?: string };

/**
 * Publica el estado actual en el buzón del grupo, cifrado.
 * Sin la clave del grupo no se publica nada: mandar en claro "por esta vez"
 * es exactamente cómo se filtran los datos.
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

  const delta = buildGroupPayload(groupId, currentUserId);
  const piezas = await buildSlicedEnvelopes(delta, key, groupId, deviceId);

  // Se manda cada rebanada (y al final el manifiesto) como su propio sobre,
  // sellado y firmado individualmente — nunca se junta el JSON entero para
  // sellarlo de una vez, porque eso sería volver a mandar el estado completo
  // en un solo sobre (el problema que ADR-007 vino a resolver).
  //
  // El `seq` que se devuelve es el del ÚLTIMO sobre mandado (el manifiesto):
  // con K+1 sobres por publicación, ningún `seq` individual representa "la"
  // publicación, pero el manifiesto es el que un lector necesita ver para
  // saber que ya llegó todo, y es el último en el orden de envío — por eso su
  // `seq` es el que tiene sentido devolver en `PublishResult`.
  let ultimoSeq: number | undefined;
  for (const pieza of piezas) {
    const sealed = sealEnvelope(key, pieza.json);

    // La firma va POR FUERA del cifrado: autentica quién lo mandó sin exponer
    // nada de lo que va adentro (T-033).
    const firmado = signEnvelope(sealed, ensureIdentity().privateKey);

    // Compactable: cada rebanada (y el manifiesto) reemplaza a la anterior con
    // la misma `ckey` de este mismo dispositivo (T-032 + ADR-007).
    const r = await sendEnvelope(topic, firmado, deviceId, true, pieza.ckey);
    if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail };

    // Fix 3: recién ACÁ, con el envío confirmado, se resetea el reloj de
    // renovación de 20 días para esta rebanada puntual. Si `publishToGroup`
    // corta antes (una pieza posterior falla), las piezas que sí salieron
    // quedan correctamente marcadas como frescas, y las que no salieron
    // nunca se marcaron — quedan elegibles para que la renovación las
    // reintente, en vez de creer falsamente que ya están al día.
    recordSlicePublished(pieza.ckey, Date.now());
    ultimoSeq = r.seq;
  }

  // `piezas` siempre tiene al menos el sobre de manifiesto, así que si se
  // llegó hasta acá sin devolver antes, `ultimoSeq` está seteado.
  return { ok: true, seq: ultimoSeq! };
}

/**
 * Saca del buzón los sobres que ESTE aparato publicó para el grupo (T-088).
 *
 * Deriva el topic igual que `publishToGroup`, así borra exactamente donde
 * publicó. Lo que NO alcanza, y hay que decirlo donde se muestre:
 *  - los sobres de OTROS miembros se quedan: cada uno borra los suyos;
 *  - los que publicó otra instalación de esta misma persona (reinstaló, o es
 *    su segundo teléfono) **no se pueden borrar desde acá**: sólo los levanta
 *    el TTL de 30 días. Es el límite de ADR-009 §4·A, y nadie lo resolvió sin
 *    identidad del lado del servidor (`ADR-009 §10.1`).
 *
 * Quién lo llama es T-074, y ese ticket tiene que purgar el buzón ANTES de
 * destruir la prenda: al revés, el secreto se pierde y los sobres quedan a
 * merced del TTL.
 */
export async function deleteMyGroupEnvelopes(
  groupId: string,
): Promise<DeleteResult | { ok: false; reason: 'no_key' }> {
  const key = groupKeyBytes(groupId);
  if (!key) return { ok: false, reason: 'no_key' };

  const record = useGroupKeyStore.getState().getKey(groupId)!;
  const topic = await deriveTopic(key, record.epoch);
  return deleteMyEnvelopes(topic);
}

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
export type DrainOptions = { pageLimit?: number; maxPages?: number };

export async function drainGroup(
  groupId: string,
  currentUserId: string,
  deviceId: string,
  sinceSeq: number,
  opts: DrainOptions = {},
): Promise<DrainResult> {
  const pageLimit = opts.pageLimit ?? DRAIN_FETCH_LIMIT;
  const maxPages = opts.maxPages ?? DRAIN_MAX_PAGES;

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
  const manifiestos: { sender: string; manifest: SliceManifest }[] = [];

  for (let pagina = 0; pagina < maxPages; pagina++) {
    const r = await fetchSince(topic, cursor, deviceId, pageLimit);
    if (!r.ok) {
      // Sin red en la primera página es un drenaje fallido. En una página
      // posterior ya hay cosas aplicadas: se devuelve hasta dónde se llegó, y
      // `completo: false` deja la marca de T-089 puesta.
      if (pagina === 0) return { ok: false, reason: r.reason, detail: r.detail };
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

    for (const envelope of r.envelopes) {
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
        manifiestos.push({ sender: envelope.sender, manifest: parsed });
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

    for (const { seq, delta, senderKey } of rebanadas) {
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
        // antes de tocar cualquier store (`acotarDeltaAlGrupo.ts`).
        const acotado = acotarDeltaAlGrupo(delta, groupId);
        applyDelta(acotado, currentUserId);
        applied++;

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
      } catch (e) {
        // TEC-01: antes esto era `catch { skipped++ }` y el cursor avanzaba
        // igual — la rebanada no volvía a pedirse hasta que su emisor la
        // republicara. Ahora se anota y, mientras quede presupuesto, se
        // devuelve el cursor JUSTO ANTES de ella para que la próxima vuelta la
        // vuelva a pedir. Agotado el presupuesto, se deja atrás con rastro.
        registrarFalloDeAplicacion(topic, seq, e);
        if (!agotoReintentos(topic, seq)) {
          void refreshPendingAuthors();
          return { ok: true, applied, skipped, cursor: seq - 1, completo: false };
        }
        skipped++;
      }
    }

    cursor = r.cursor;
    if (r.envelopes.length < pageLimit) {
      completo = true;
      break;
    }
  }

  // Manifiesto: se chequea UNA vez, al final, y sólo si se leyó hasta el
  // fondo. Con una página recortada por delante, el manifiesto o sus rebanadas
  // pueden estar ahí y un gap acá sería un falso positivo sin mitigación. Se
  // prefiere no decir nada a mentir. Un gap NUNCA descarta ni deja de aplicar
  // rebanadas que sí llegaron: sólo se REGISTRA para avisar en la UI.
  //
  // Por remitente: el servidor compacta por topic + prenda + ckey, o sea por
  // dispositivo — el manifiesto de A sólo se completa con rebanadas de A.
  if (completo && manifiestos.length > 0) {
    // T-146, ronda 2 del verifier (D3): `isManifest` ya valida cada entrada,
    // así que `entry.ckey`/`entry.digest` deberían ser siempre `string` acá.
    // Aun así, este bloque queda envuelto: nada de lo que corre DESPUÉS de
    // abrir sobres —ni siquiera un chequeo que hoy es seguro— puede volver a
    // tirar fuera del manejo con rastro. Si algo tira igual (p.ej. la
    // librería de digest), se anota y el drenaje TERMINA igual: `applied`,
    // `skipped` y `cursor` de las rebanadas ya procesadas no se pierden.
    try {
      const faltantes: string[] = [];
      for (const { sender, manifest } of manifiestos) {
        const recibidas = recibidasPorRemitente.get(sender) ?? new Map<string, string>();
        for (const entry of manifest.entries) {
          const json = recibidas.get(entry.ckey);
          if (json === undefined) {
            faltantes.push(entry.ckey);
            continue;
          }
          // La ckey llegó, pero su CONTENIDO tiene que coincidir con el digest
          // declarado: un sobre corrupto o una versión vieja bajo esa ckey se
          // reporta como faltante. Nunca bloquea la aplicación de arriba.
          const digest = await digestOfJson(json);
          if (digest !== entry.digest) faltantes.push(entry.ckey);
        }
      }
      recordManifestCheck(groupId, faltantes);
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

  return { ok: true, applied, skipped, cursor, completo };
}
