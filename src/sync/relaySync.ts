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
import { buildManifest, isManifest, type SliceManifest } from './manifest';
import { recordManifestCheck } from './manifestHealth';

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
): Promise<{ ckey: string; json: string }[]> {
  const piezas: { ckey: string; json: string }[] = [];

  for (const campo of SLICED_FIELDS) {
    const lista = (delta[campo] ?? []) as { id: string }[];
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
  const piezas = await buildSlicedEnvelopes(delta, key);

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
  const rebanadasRecibidas: { ckey?: string; sender: string; delta: SyncDelta; senderKey: string }[] = [];
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
    const ckeysRecibidasPorRemitente = new Map<string, Set<string>>();
    for (const reb of rebanadasRecibidas) {
      if (!reb.ckey) continue;
      let set = ckeysRecibidasPorRemitente.get(reb.sender);
      if (!set) {
        set = new Set();
        ckeysRecibidasPorRemitente.set(reb.sender, set);
      }
      set.add(reb.ckey);
    }

    const faltantes: string[] = [];
    for (const { sender, manifest } of manifiestos) {
      const recibidas = ckeysRecibidasPorRemitente.get(sender) ?? new Set<string>();
      for (const entry of manifest.entries) {
        if (!recibidas.has(entry.ckey)) faltantes.push(entry.ckey);
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
      applyDelta(acotarDeltaAlGrupo(delta, groupId), currentUserId);
      applied++;
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
