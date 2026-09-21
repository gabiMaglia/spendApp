import { buildDelta, applyDelta, type SyncDelta } from './useSyncQR';
import { acotarDeltaAlGrupo } from './acotarDeltaAlGrupo';
import { sealEnvelope, openEnvelope, deriveTopic, type GroupKey } from './envelopeCrypto';
import { sendEnvelope, fetchSince, deleteMyEnvelopes, type DeleteResult } from './relay';
import { groupKeyBytes, useGroupKeyStore } from '@/src/store/groupKeyStore';
import { ensureIdentity } from '@/src/store/identityStore';
import { signEnvelope, verifyEnvelope } from './envelopeSign';
import { observeAuthor } from './authorHealth';
import { refreshPendingAuthors } from './authorKeys';
import { sliceEntities, deriveCkey } from './slices';
import { buildManifest, digestOfJson, isManifest, type SliceManifest } from './manifest';
import { recordManifestCheck } from './manifestHealth';
import { recordSlicePublished } from './sliceRenewal';
import { publishAvatarIfOwn, fetchAvatarIfMissing } from './avatarTopic';

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
    for (const rebanada of rebanadas) {
      const seedId = rebanada[0]!.id;
      const ckey = await deriveCkey(key, campo, seedId);
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
  | { ok: true; applied: number; skipped: number; cursor: number }
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
 */
/**
 * Límite de `fetchSince` para este drenaje, explícito acá (en vez de confiar
 * en el default de la función) para poder compararlo después contra
 * `r.envelopes.length` — ver el chequeo de página recortada más abajo
 * (revisión de Task 6, hallazgo #3).
 */
const DRAIN_FETCH_LIMIT = 200;

export async function drainGroup(
  groupId: string,
  currentUserId: string,
  deviceId: string,
  sinceSeq: number,
): Promise<DrainResult> {
  const key = groupKeyBytes(groupId);
  if (!key) return { ok: false, reason: 'no_key' };

  const record = useGroupKeyStore.getState().getKey(groupId)!;
  const topic = await deriveTopic(key, record.epoch);

  const r = await fetchSince(topic, sinceSeq, deviceId, DRAIN_FETCH_LIMIT);
  if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail };

  // T-136 · D-1: la clave cambió mientras se esperaba la red. El lote entero
  // se descarta ANTES de abrir un solo sobre: nada se aplica y quien llama no
  // avanza el cursor ni limpia la marca de pendiente.
  if (!sigueSiendoLaClave(groupId, record)) return { ok: false, reason: 'key_changed' };

  let applied = 0;
  let skipped = 0;

  // Con ADR-007 lo que llega ya no es "un delta por sobre": son rebanadas de
  // datos MÁS, en cualquier posición del lote, uno o más sobres de manifiesto
  // (Task 5/`buildSlicedEnvelopes`). Por eso el drenaje pasa a ser DOS pasadas:
  //
  //  1. Colección: abrir y descifrar cada sobre, y separar manifiestos de
  //     rebanadas de datos — sin aplicar nada todavía. El manifiesto puede
  //     llegar en cualquier posición dentro de ESTE MISMO drenaje (aunque
  //     `publishToGroup` siempre lo manda al final, `fetchSince` puede haber
  //     recortado el lote, o el manifiesto puede venir de una publicación
  //     distinta a las rebanadas), así que hay que ver TODO el lote antes de
  //     poder decidir qué falta.
  //  2. Aplicación: recorrer las rebanadas de datos EN EL MISMO ORDEN en que
  //     se recibieron (`seq` ascendente, tal cual las entrega `fetchSince`).
  //     Este orden es load-bearing — ver el comentario sobre `SLICED_FIELDS`
  //     más arriba: `users` y `comments` dependen de que `groups`/`expenses`
  //     de la MISMA publicación ya se hayan aplicado. Reordenar acá (por
  //     ejemplo, aplicar primero por tipo de campo) rompería esa garantía.
  const rebanadasRecibidas: { ckey?: string; sender: string; delta: SyncDelta; senderKey: string; json: string }[] = [];
  const manifiestos: { sender: string; manifest: SliceManifest }[] = [];

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
      // Descifró pero el JSON no era válido: se saltea igual.
      skipped++;
      continue;
    }

    if (isManifest(parsed)) {
      manifiestos.push({ sender: envelope.sender, manifest: parsed });
      continue;
    }

    // `senderKey` viaja por sobre, no por delta: hay que guardarlo acá, en la
    // colección, para no perderlo de vista para cuando se aplique este delta
    // en la segunda pasada (ver nota de revisión de Task 6).
    rebanadasRecibidas.push({
      ckey: envelope.ckey,
      sender: envelope.sender,
      delta: parsed as SyncDelta,
      senderKey: firmado.senderKey,
      // Fix 4: se guarda el JSON plano (post-descifrado, pre-parse) de esta
      // rebanada — hace falta para recalcular su digest y compararlo contra
      // lo que el manifiesto declaró, más abajo.
      json: plain,
    });
  }

  // Manifiesto: chequear completitud ANTES de aplicar, para no depender de en
  // qué posición del lote cayó el sobre de manifiesto. Un gap acá sólo se
  // REGISTRA para avisar en la UI más tarde (Task 7) — nunca es motivo para
  // descartar o dejar de aplicar rebanadas que sí llegaron bien: un publish no
  // es atómico (revisión de Task 5), así que un manifiesto desactualizado o
  // incompleto en el buzón es un caso esperado, y LWW + `applyDelta` ya
  // manejan con seguridad un estado parcial.
  //
  // El chequeo es POR REMITENTE (revisión de Task 6, hallazgo #2): el servidor
  // compacta por topic + prenda de escritura + ckey — es decir, por
  // dispositivo — así que el manifiesto de un remitente sólo puede completarse con las
  // rebanadas DE ESE MISMO remitente. Pooler todo junto dejaría que las
  // ckeys de un dispositivo B taparan (o generaran) falsos gaps del
  // manifiesto de un dispositivo A, aunque A y B nunca compartan ckeys.
  //
  // Y sólo corre si esta página de `fetchSince` no vino recortada (revisión de
  // Task 6, hallazgo #3): si `fetchSince` devolvió justo `DRAIN_FETCH_LIMIT`
  // sobres, puede haber más esperando en el servidor —el manifiesto o sus
  // rebanadas podrían estar en la próxima página— y calcular un gap acá sería
  // un falso positivo sin mitigación. Se prefiere no decir nada a mentir.
  const paginaCompleta = r.envelopes.length < DRAIN_FETCH_LIMIT;
  if (manifiestos.length > 0 && paginaCompleta) {
    // ckey -> json recibido, por remitente. Se guarda el JSON (no sólo un
    // Set de presencia) porque el chequeo de completitud (Fix 4, revisión
    // final) ya no es sólo "¿llegó esta ckey?" — también hace falta poder
    // recalcular su digest para compararlo contra lo que el manifiesto
    // declaró.
    const recibidasPorRemitente = new Map<string, Map<string, string>>();
    for (const reb of rebanadasRecibidas) {
      if (!reb.ckey) continue;
      let mapa = recibidasPorRemitente.get(reb.sender);
      if (!mapa) {
        mapa = new Map();
        recibidasPorRemitente.set(reb.sender, mapa);
      }
      mapa.set(reb.ckey, reb.json);
    }

    const faltantes: string[] = [];
    for (const { sender, manifest } of manifiestos) {
      const recibidas = recibidasPorRemitente.get(sender) ?? new Map<string, string>();
      for (const entry of manifest.entries) {
        const json = recibidas.get(entry.ckey);
        if (json === undefined) {
          faltantes.push(entry.ckey);
          continue;
        }
        // Fix 4: la ckey llegó, pero eso no alcanza — su CONTENIDO tiene que
        // coincidir con el digest que el manifiesto declaró para ella. Un
        // sobre corrupto, o una versión vieja/equivocada que terminó
        // aterrizando bajo esa ckey, se trata igual que si nunca hubiera
        // llegado, a los fines del aviso de gap. Esto NUNCA bloquea que la
        // rebanada se aplique — sólo afecta qué se reporta como faltante; el
        // merge de abajo (LWW + `applyDelta`) sigue procesando exactamente
        // las mismas `rebanadasRecibidas`, sin filtrar por este chequeo.
        const digest = await digestOfJson(json);
        if (digest !== entry.digest) faltantes.push(entry.ckey);
      }
    }
    recordManifestCheck(groupId, faltantes);
  }

  for (const { delta, senderKey } of rebanadasRecibidas) {
    // 3. Autoría (ADR-004 fase B) — en modo AVISO. La firma prueba que quien
    // mandó tiene la privada de SU dispositivo; esto mira si ese dispositivo
    // está registrado bajo la cuenta que el delta dice ser. Va sin `await` a
    // propósito: es observación, y no puede meterse en el camino del sync ni
    // agregarle la latencia de una consulta por sobre.
    void observeAuthor(groupId, delta.fromUserId, senderKey);

    try {
      // S3-A1: acá pasaba el delta crudo. La firma y el cifrado sólo prueban
      // quién lo mandó y que tiene la clave del TOPIC — nunca acotan qué puede
      // venir adentro. Se arma un delta nuevo, campo por campo, con sólo lo que
      // pertenece a `groupId` antes de tocar cualquier store (ver
      // `acotarDeltaAlGrupo.ts`).
      const acotado = acotarDeltaAlGrupo(delta, groupId);
      applyDelta(acotado, currentUserId);
      applied++;

      // Fotos por referencia (Task 9): si esta rebanada trajo perfiles con
      // `avatarDigest`, y el digest no es el que ya tenemos cacheado, se pide
      // la foto aparte. Se espera acá (no fire-and-forget, a diferencia de
      // `observeAuthor`/`refreshPendingAuthors` de abajo): esos son
      // diagnóstico fuera de banda que puede esperar a la próxima vuelta, pero
      // el perfil recién aplicado por `mergeUsers` es lo que la UI muestra ya
      // mismo, y un miembro nuevo que recién ve a los demás por primera vez
      // necesita la foto en el mismo drenaje, no en el próximo ciclo de sync.
      //
      // **Hallazgo #2 de la revisión (Critical, clase T-132/S3-A1):** este
      // loop tiene que iterar `acotado.users` (la salida YA filtrada por
      // `acotarDeltaAlGrupo`), NUNCA `delta.users` crudo. `acotarDeltaAlGrupo`
      // existe justamente para descartar entradas de `users` de gente que no
      // es miembro local de `groupId` — iterar el delta sin acotar reabre esa
      // misma clase de ataque sólo para las fotos: un miembro de OTRO grupo
      // podría declarar un `avatarDigest` para un contacto ajeno a `groupId`
      // y este código lo buscaría y adoptaría igual, aunque el merge de datos
      // ya lo hubiera descartado.
      //
      // Los fetches van en paralelo (hallazgo #4): son independientes entre
      // sí, y esperarlos uno por uno serializa N round-trips de red por cada
      // drenaje para un grupo con muchos miembros sin foto cacheada todavía.
      await Promise.all(
        (acotado.users ?? [])
          .filter(u => u.avatarDigest && u.id !== currentUserId)
          .map(u => fetchAvatarIfMissing(groupId, u.id, u.avatarDigest!)),
      );
    } catch {
      skipped++;
    }
  }

  /**
   * Refresco de claves de autor FUERA DE BANDA (T-041 · S4).
   *
   * El merge no puede consultar el directorio: `applyDelta` es síncrono. Lo que
   * hace es encolar los autores que no pudo resolver, y la consulta sale acá,
   * una vez por vuelta, **sin `await`** — igual que `observeAuthor` arriba. Lo
   * que aprenda sirve para la próxima vuelta; una clave que todavía no está
   * produce `no_verificable`, que nunca es un rechazo.
   *
   * Con la cola vacía no hace absolutamente nada, que es el caso de hoy: hasta
   * que S6 verifique en el merge, nadie encola.
   */
  void refreshPendingAuthors();

  return { ok: true, applied, skipped, cursor: r.cursor };
}
