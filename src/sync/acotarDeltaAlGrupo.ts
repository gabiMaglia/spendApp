import type { SyncDelta } from './useSyncQR';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useRecurringStore } from '@/src/store/recurringStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useUserStore } from '@/src/store/userStore';

/**
 * Lo que este módulo necesita saber del estado LOCAL — tomado ANTES de
 * mergear el sobre que se está acotando — para poder desconfiar de lo que el
 * propio sobre declara. Es una interfaz (no los stores directamente) para que
 * `acotarDeltaAlGrupo` sea pura y testeable sin Zustand real (ronda 2 de
 * T-132, `engram/qa/T-132.md`).
 */
export interface LocalSnapshot {
  /** `memberIds` del grupo tal como está AHORA, antes de este sobre. */
  groupMemberIds(groupId: string): string[] | undefined;
  /** `groupId` con el que YA existe ese id de gasto, si existe. */
  expenseGroupId(id: string): string | undefined;
  /** Igual, para pagos. */
  paymentGroupId(id: string): string | undefined;
  /** Igual, para plantillas recurrentes. */
  recurringGroupId(id: string): string | undefined;
  /** `expenseId` con el que YA existe ese id de comentario, si existe. */
  commentExpenseId(id: string): string | undefined;
  /** ¿Ya tenemos ALGÚN perfil guardado para este id de usuario? */
  knownUser(id: string): boolean;
}

function snapshotFromStores(): LocalSnapshot {
  const groups = useGroupStore.getState().groups;
  const expenses = useExpenseStore.getState().expenses;
  const payments = usePaymentStore.getState().payments;
  const recurring = useRecurringStore.getState().recurring;
  const comments = useCommentStore.getState().comments;
  const userIds = new Set(useUserStore.getState().users.map(u => u.id));

  return {
    groupMemberIds: (id) => groups.find(g => g.id === id)?.memberIds,
    expenseGroupId: (id) => expenses.find(e => e.id === id)?.groupId,
    paymentGroupId: (id) => payments.find(p => p.id === id)?.groupId,
    recurringGroupId: (id) => recurring.find(r => r.id === id)?.groupId,
    commentExpenseId: (id) => comments.find(c => c.id === id)?.expenseId,
    knownUser: (id) => userIds.has(id),
  };
}

/**
 * Acota un delta recibido por el RELAY a lo que ese grupo puede legítimamente
 * traer (S3-A1, `qa/SEC3-2026-09-14.md` §2).
 *
 * `drainGroup` descifra el sobre con la clave del topic de UN grupo, pero eso
 * sólo prueba que quien lo selló tiene esa clave — no acota de ningún modo QUÉ
 * puede venir adentro. Antes de este fix el delta entero se pasaba crudo a
 * `applyDelta` (la función del pairing QR, pensada para un canal autenticado
 * por presencia física), así que un co-miembro de A podía colar la clave de
 * OTRO grupo B (con época enorme → sustitución persistente), movimientos
 * `personal` de la víctima, o un gasto con `groupId: ''` (que T-116 muestra en
 * la pestaña Personal).
 *
 * Es el espejo de `buildGroupPayload` (relaySync.ts) pero del lado receptor:
 * ese arma el sobre campo por campo con LO PROPIO; éste, ante un sobre que
 * puede ser hostil, se queda sólo con lo que puede pertenecer al `groupId`
 * del topic — nunca confía en que el emisor haya sido honesto.
 *
 * `groupKeys` y `personal` **siempre** vuelven vacíos: ningún dato de esos dos
 * campos tiene razón de ser en un sobre del relay (ADR-003 §1 — las claves
 * sólo viajan por el pairing QR).
 *
 * **Ronda 2 (`engram/qa/T-132.md`, `engram/qa/T-132-verifier.md`):** la
 * primera versión filtraba por lo que el propio registro entrante DECLARABA
 * (`groupId`, `expenseId`, `memberIds`) — pero el merge de abajo
 * (`mergeByIdLevels`/`mergeByIdLWW`, `src/store/mergeLevels.ts`,
 * `src/store/lww.ts`) une por **`id`**, sin verificar esos campos contra nada.
 * Eso dejaba tres vías: (1) robar y borrar un gasto/pago/recurrente que YA es
 * local de OTRO grupo, mandándolo con `id` repetido y `groupId` propio; (2)
 * reescribir un comentario ajeno igual, por `id`; (3) suplantar el perfil de
 * un usuario YA CONOCIDO metiéndolo en el `memberIds` del PROPIO sobre (el
 * mismo sobre que declara la membresía es el que trae el perfil falso — nada
 * externo lo contradice). Por eso cada filtro de abajo consulta el estado
 * LOCAL (`LocalSnapshot`, tomado ANTES de aplicar este sobre) además de lo
 * declarado:
 *
 *  - `expenses`/`payments`/`recurring`: el `id` entrante sólo se acepta si NO
 *    es ya local de otro grupo (si es nuevo, o ya es local de `groupId`, pasa).
 *  - `comments`: cuelgan de un gasto que es de `groupId` — ya local, o
 *    sobrevivió el filtro de arriba EN ESTE MISMO sobre — y además el `id`
 *    del comentario, si ya es local, tiene que colgar de un gasto que también
 *    sea de `groupId` (si no, es un comentario ajeno que se está reasignando).
 *  - `users`: la autoridad de membresía es **sólo** el snapshot local previo
 *    (nunca el `groups` del propio sobre). Un id YA CONOCIDO localmente sólo
 *    entra si YA es miembro local de `groupId`; si el id es TOTALMENTE nuevo
 *    (sin perfil previo que pisar), entra igual — es el caso normal de "me
 *    uno a un grupo y veo los perfiles de sus miembros" (regla #8). **Efecto
 *    colateral documentado:** si el dueño real de A agrega a un miembro que
 *    la víctima YA conocía de otro grupo, ese perfil no se actualiza por A
 *    hasta el PRÓXIMO drenaje — recién cuando la membresía de A (que si se
 *    actualiza en este mismo sobre, vía `groups`) ya forme parte del snapshot
 *    local del drenaje siguiente. Con la sync automática cada 15' (regla #10
 *    de CLAUDE.md) esto se autocorrige solo, sin ventana de suplantación.
 */
export function acotarDeltaAlGrupo(
  delta: SyncDelta,
  groupId: string,
  local: LocalSnapshot = snapshotFromStores(),
): SyncDelta {
  const gruposDelGrupo = delta.groups.filter(g => g.id === groupId);

  /** El `id` es nuevo (no lo teníamos) o ya era local de este mismo grupo. */
  const noRoba = (idLocal: string | undefined): boolean =>
    idLocal === undefined || idLocal === groupId;

  const expenses = delta.expenses.filter(e =>
    e.groupId === groupId && noRoba(local.expenseGroupId(e.id)));
  const payments = delta.payments.filter(p =>
    p.groupId === groupId && noRoba(local.paymentGroupId(p.id)));
  const recurring = (delta.recurring ?? []).filter(r =>
    r.groupId === groupId && noRoba(local.recurringGroupId(r.id)));

  const idsDeGastos = new Set(expenses.map(e => e.id));
  /** ¿Este `expenseId` es (o va a ser) de `groupId`? Local, o recién llegado. */
  const esGastoDelGrupo = (expenseId: string): boolean =>
    idsDeGastos.has(expenseId) || local.expenseGroupId(expenseId) === groupId;

  const comments = (delta.comments ?? []).filter(c => {
    if (!esGastoDelGrupo(c.expenseId)) return false;
    const expenseLocalDelComentario = local.commentExpenseId(c.id);
    // El comentario ya existe colgado de un gasto que NO es de este grupo:
    // no se puede "reasignar" reescribiéndolo con un expenseId de acá.
    return expenseLocalDelComentario === undefined || esGastoDelGrupo(expenseLocalDelComentario);
  });

  const miembrosLocales = new Set(local.groupMemberIds(groupId) ?? []);
  const users = delta.users.filter(u =>
    !local.knownUser(u.id) || miembrosLocales.has(u.id));

  return {
    version: delta.version,
    featureVersion: delta.featureVersion,
    fromUserId: delta.fromUserId,
    timestamp: delta.timestamp,

    groups: gruposDelGrupo,
    expenses,
    payments,
    users,
    recurring,
    comments,

    // Nunca desde el relay: ver comentario de arriba.
    personal: [],
    groupKeys: [],
  };
}
