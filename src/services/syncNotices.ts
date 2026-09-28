import type { CurrencyCode } from '@/src/constants/currencies';
import type { Expense, ExpenseComment, Group, Payment } from '@/src/types/models';
// Sólo el tipo: `publishHealth` no puede entrar al grafo de módulos de acá.
import type { BlockingReason } from '@/src/sync/publishHealth';
import { mismaPersona } from '@/src/store/identityAlias';

/**
 * Qué avisar después de un sync (T-010).
 *
 * Es la mitad PURA de las notificaciones: mira el antes y el después de una
 * bajada y decide qué merece un aviso. La entrega (permiso, expo-notifications,
 * preferencias) vive en `notifications.ts`. La separación es a propósito —
 * decidir qué avisar es la parte con reglas, y las reglas se testean.
 *
 * Tres reglas mandan sobre todo lo demás:
 *
 *  1. **Lo propio nunca se avisa.** Un gasto que cargué yo vuelve por el sync
 *     como cualquier otro registro. Avisarlo sería notificarle al usuario algo
 *     que acaba de hacer con el teléfono en la mano.
 *  2. **Se agrega, no se repite.** Entrar a un grupo con 50 gastos tiene que
 *     producir UN aviso, no 50. Es la diferencia entre una app que avisa y una
 *     que se vuelve insoportable el primer día.
 *  3. **Sólo lo que apareció en ESTA bajada.** El antes/después es lo que
 *     distingue "nuevo" de "ya estaba"; sin eso, cada relectura por cursor
 *     volvería a avisar lo mismo.
 */

export type Notice =
  /** Llegaron gastos ajenos a un grupo. */
  | { kind: 'expenses'; groupId: string; groupName: string; count: number }
  /**
   * Alguien deshizo un borrado que este teléfono ya había aplicado.
   *
   * Es la contraparte que faltaba: avisar el borrado y callar la restauración
   * dejaba al usuario creyendo enterrado un gasto que volvió a contar en su
   * balance. La mala noticia llegaba y la buena no.
   */
  | { kind: 'restored'; groupId: string; groupName: string; description: string }
  /** Entramos a un grupo nuevo (nos entregaron la clave). */
  | { kind: 'joined'; groupId: string; groupName: string }
  /**
   * Alguien registró un saldo que me involucra (ADR-006, decisión 5).
   *
   * Sólo avisa de lo que registró OTRO: un pago propio ya se conoce, y avisarlo
   * sería contarle al usuario algo que acaba de hacer.
   */
  | { kind: 'settled'; groupId: string; groupName: string; amount: number; currency: CurrencyCode }
  /**
   * Este grupo dejó de sincronizar por algo que NO se arregla esperando
   * (T-058). El banner del detalle del grupo ya lo dice, pero es contextual: si
   * no entrás a ESE grupo, no te enterás de que tus gastos no le están llegando
   * a nadie. Es el caso donde no saber sale más caro.
   *
   * Quién decide que una caída merece aviso —y que avise UNA vez y no una por
   * intento— vive en `sync/syncDownNotices.ts`.
   */
  | { kind: 'sync_down'; groupId: string; groupName: string; reason: BlockingReason }
  /**
   * Dos o más contactos entregaron claves DISTINTAS para el mismo grupo
   * (T-136 · ADR-013). No se adoptó ninguna sola: el usuario elige.
   *
   * El nombre se muestra siempre «sin verificar» (`nombreDeGrupoEnConflicto`):
   * pudo escribirlo el remitente. `senderIds` es la foto del momento del aviso; la
   * tarjeta relee las ofertas vivas (`ofertasDe`).
   */
  | { kind: 'group_key_conflict'; groupId: string; groupName: string; senderIds: string[] }
  /**
   * El reloj del teléfono está mal por más de cinco minutos (T-038).
   *
   * El merge ya está corregido —`syncedNow()` lo compensa contra el relay— pero
   * **las fechas que el usuario ve salen del reloj del aparato** y ésas no se
   * corrigen solas. Quién decide que avise UNA vez vive en `sync/clockNotice.ts`.
   */
  | { kind: 'clock_off'; offsetMs: number }
  /**
   * Un grupo del que soy miembro se traspasó a uno nuevo por el límite de
   * gastos (T-058, PO 2026-09-20) — el viejo queda archivado, de solo
   * lectura. Informativo: el traspaso ya se aplicó, no hay nada que
   * aprobar u objetar.
   */
  | { kind: 'group_replaced'; groupId: string; groupName: string; newGroupId: string; newGroupName: string }
  /**
   * Alguien intentó entrar por un link a un grupo que ya está en
   * `MAX_MIEMBROS` (T-150 ronda 2/5, ruling del orquestador). `admit()`
   * rechaza el reclamo sin sumar a nadie — antes eso sólo dejaba rastro en el
   * diagnóstico (`inviteEngine.ts`), invisible para quien invita. Informativo:
   * no hay nada que aprobar acá, el reclamo ya fue rechazado.
   */
  | { kind: 'group_invite_full'; groupId: string; groupName: string; inviteToken: string }
  /**
   * El reclamo de ingreso por link se agotó sin recibir la clave (T-172,
   * ítem 2). `processInvite`/`admit` lo reintentan en silencio en cada sync
   * (identidad no pinneada, tope de miembros, canje ajeno — ver
   * `inviteEngine.ts`); sin este aviso, el invitado nunca se entera de que su
   * ingreso no se va a completar solo y sigue esperando hasta que la
   * invitación expira (48hs). Informativo con una acción FUERA de la app
   * (pedir un link nuevo), mismo criterio que `clock_off`.
   */
  | { kind: 'join_claim_stalled'; groupId: string; groupName: string; inviteToken: string }
  /**
   * Una plantilla recurrente no se pudo re-firmar durante un traspaso de
   * grupo por límite (T-058) y `updateRecurring` la bloqueó — no la movió —
   * para no perderla en silencio (T-152 · D2, mismo mecanismo que un gasto
   * editado sin clave). Antes esto sólo dejaba rastro en `errorLog.ts`: la
   * plantilla queda congelada en el grupo viejo, ya archivado. Informativo:
   * el traspaso del resto ya se aplicó, no hay nada que aprobar.
   */
  | { kind: 'group_traspaso_recurring_blocked'; groupId: string; groupName: string; newGroupId: string }
  /**
   * Comentaron un gasto compartido (T-194).
   *
   * Mismo criterio que `expenses`: se agrega por grupo (regla 2 — un aviso, no
   * uno por comentario) y nunca avisa lo propio (regla 1). Antes de esto el
   * comentario llegaba y se mergeaba bien (`acotarDeltaAlGrupo`/`commentStore`
   * ya andaban) — lo que faltaba era que `Snapshot`/`noticesFor` ni siquiera
   * miraran `comments`, así que no había NADA que comparar para decidir "esto
   * es nuevo".
   */
  | { kind: 'comment'; groupId: string; groupName: string; count: number };

/**
 * ¿Este aviso pide que el usuario HAGA algo, o sólo informa? (T-062)
 *
 * Sólo `sync_down` tiene algo que el usuario deba resolver de por sí; el
 * resto es historia. Switch exhaustivo A PROPÓSITO, sin `default`: el tipo de
 * retorno obliga a cubrir todos los casos, así que agregar un `kind` a
 * `Notice` sin decidir acá no compila (mismo patrón que `claveDeFalloDeSync`
 * en `sync/useSyncFailure.ts`).
 *
 * Es la cuarta vez que este repo necesita esta clasificación — T-055, T-057,
 * T-060 y la clasificación por descarte de T-063 — y todas las anteriores
 * eran una lista aparte que se desincronizaba del tipo. Ésta no puede.
 */
export function esAccionable(kind: Notice['kind']): boolean {
  switch (kind) {
    case 'sync_down':
    // Accionable aunque lo que hay que hacer esté FUERA de la app: si se
    // clasificara como historia, el usuario no arreglaría nunca la hora y
    // seguiría viendo fechas equivocadas sin saber por qué.
    case 'clock_off':
    // T-136: leerlo no resuelve nada; hay que elegir una clave.
    case 'group_key_conflict':
    // T-172 (ítem 2): igual que `clock_off`, lo que hay que hacer está FUERA
    // de la app (pedir un link nuevo) pero hay algo concreto que hacer.
    case 'join_claim_stalled':
      return true;
    case 'expenses':
    case 'settled':
    case 'restored':
    case 'joined':
    case 'group_replaced':
    // T-150 ronda 2/5: el reclamo ya fue rechazado, no hay nada que resolver.
    case 'group_invite_full':
    // T-172 (ítem 3): el traspaso del resto ya se aplicó, no hay nada que aprobar.
    case 'group_traspaso_recurring_blocked':
    // T-194: mismo criterio que `expenses` — enterarse de un comentario no
    // pide ninguna acción.
    case 'comment':
      return false;
  }
}

export type KeyConflictNotice = Extract<Notice, { kind: 'group_key_conflict' }>;

/**
 * Nombre del grupo tal como se muestra en un conflicto de clave (T-136).
 * Una sola función para el aviso y para la tarjeta: dos redacciones del mismo
 * «sin verificar» se contradicen sin que nadie mire.
 *
 * SIEMPRE «sin verificar» (PO, 2026-09-14): aunque el grupo exista localmente,
 * pudo drenarse con la clave en disputa y su nombre ser del atacante.
 */
export function nombreDeGrupoEnConflicto(
  notice: Pick<KeyConflictNotice, 'groupName'>,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  return t('sync.key_conflict.unverified_name', { group: notice.groupName });
}

export type Snapshot = {
  /** Ids de gastos vivos conocidos ANTES de la bajada. */
  expenseIds: string[];
  /** Ids de pagos vivos conocidos ANTES. Sin esto, un saldo entraba al balance sin anunciarse. */
  paymentIds: string[];
  /**
   * Ids de gastos que este teléfono tenía BORRADOS.
   *
   * Es lo que convierte una restauración en un evento en vez de un estado: sin
   * esto, un device que entra tarde y baja el historial completo anunciaría
   * restauraciones de hace meses como si acabaran de pasar.
   */
  borrados: string[];
  /**
   * Ids de grupo → id del grupo que lo reemplaza, tal como estaban en la
   * FOTO DE ANTES (T-058, PO 2026-09-20). Es lo que distingue "esto se
   * traspasó recién" de "ya lo sabía" para el aviso `group_replaced`.
   */
  traspasosConocidos: Record<string, string>;
  /**
   * Ids de comentarios vivos conocidos ANTES de la bajada (T-194).
   *
   * Opcional para no romper snapshots armados a mano en tests viejos (sin
   * esto, cualquier literal `{ expenseIds, paymentIds, borrados,
   * traspasosConocidos }` dejaría de tipar). `noticesFor` lo trata como
   * ausente = "ninguno conocido", nunca como error.
   */
  commentIds?: string[];
};

export function snapshot(
  expenses: Expense[],
  now: number,
  groups: Group[],
  payments: Payment[] = [],
  comments: ExpenseComment[] = [],
): Snapshot {
  const vivos = expenses.filter(e => !e.isDeleted);
  const traspasosConocidos: Record<string, string> = {};
  for (const g of groups) {
    if (g.supersededByGroupId) traspasosConocidos[g.id] = g.supersededByGroupId;
  }
  return {
    expenseIds: vivos.map(e => e.id),
    paymentIds: payments.filter(p => !p.isDeleted).map(p => p.id),
    borrados: expenses.filter(e => e.isDeleted).map(e => e.id),
    traspasosConocidos,
    commentIds: comments.filter(c => !c.isDeleted).map(c => c.id),
  };
}

/**
 * Compara el antes con el después y arma los avisos.
 *
 * `joined` no sale de comparar: lo informa el canal de contactos, que es quien
 * sabe que acaba de adoptar una clave.
 */
export function noticesFor(
  before: Snapshot,
  expensesAfter: Expense[],
  groups: Group[],
  currentUserId: string,
  now: number,
  paymentsAfter: Payment[] = [],
  commentsAfter: ExpenseComment[] = [],
): Notice[] {
  /**
   * «¿Fui yo?» — con las identidades viejas incluidas (T-048 · D-3).
   *
   * Se comparan los dos ids entre sí y **no** con `esYo()`, porque acá el
   * usuario llega por parámetro: `esYo()` preguntaría por la sesión activa y
   * daría `false` para todos si esta función corriera sin sesión, convirtiendo
   * «lo cargué yo» en «me lo avisan igual». Comparando los dos lados, sin
   * sesión el comportamiento es idéntico al de antes.
   *
   * Sin esto, quien enlazó cuentas recibe avisos de SUS PROPIOS gastos viejos
   * cada vez que un peer republica el estado del grupo — o sea, para siempre y
   * cada 20 segundos.
   */
  const esMio = (id: string | undefined): boolean =>
    id !== undefined && mismaPersona(id, currentUserId);

  const conocidos = new Set(before.expenseIds);
  const teniaBorrados = new Set(before.borrados);
  const nombre = (id: string) => groups.find(g => g.id === id)?.name ?? '';

  // Un grupo que no está en la lista no es mío: no se avisa nada de él.
  const mios = new Set(groups.filter(g => !g.isDeleted).map(g => g.id));

  const nuevosPorGrupo = new Map<string, number>();
  const restauraciones: Notice[] = [];

  for (const e of expensesAfter) {
    if (e.isDeleted || !mios.has(e.groupId)) continue;

    // Regla 1: lo que cargué yo no se avisa, aunque vuelva por el sync.
    // Y lo que yo tenía borrado y volvió no es NUEVO: es el mismo de antes.
    // Sin esa segunda mitad, una restauración salía por duplicado — «1 gasto
    // nuevo» y «lo restauraron» por el mismo evento.
    if (!conocidos.has(e.id) && !teniaBorrados.has(e.id) && !esMio(e.createdById)) {
      nuevosPorGrupo.set(e.groupId, (nuevosPorGrupo.get(e.groupId) ?? 0) + 1);
    }

    /**
     * Un gasto que ACABA de volver de estar borrado.
     *
     * La condición que lo hace un evento es `teniaBorrados`: tiene que haber
     * estado borrado en ESTE teléfono. Mirar sólo `restoredById` avisaría de
     * nuevo en cada recálculo mientras el campo siga puesto, y le anunciaría a
     * un device recién llegado restauraciones que pasaron hace meses — por eso
     * la condición sigue siendo `teniaBorrados`, no el campo.
     *
     * **T-186 (riesgo 5 del doc de extracción):** sin ronda que mirar, quién
     * restauró sale de `restoredById` (T-186, opción B, campo del «resto» sin
     * firma) en vez de `ronda.stoppedBy`. Llegar acá ya significa que el gasto
     * está vivo —el `continue` de arriba descarta los borrados— y
     * `teniaBorrados` significa que antes no lo estaba. Eso ES la
     * restauración. Lo único que sigue exceptuado es haberla hecho uno mismo.
     */
    if (teniaBorrados.has(e.id)) {
      const loRestauréYo = esMio(e.restoredById);
      if (!loRestauréYo) {
        restauraciones.push({
          kind: 'restored',
          groupId: e.groupId,
          groupName: nombre(e.groupId),
          description: e.description,
        });
      }
    }
  }

  // Regla 2: uno por grupo con el total, no uno por gasto.
  const porGastos: Notice[] = [...nuevosPorGrupo.entries()].map(([groupId, count]) => ({
    kind: 'expenses' as const,
    groupId,
    groupName: nombre(groupId),
    count,
  }));

  /**
   * Saldos que registró OTRO y me involucran.
   *
   * `createdById !== yo` es la condición que importa: un pago propio ya se
   * conoce, y avisarlo sería contarle al usuario algo que acaba de hacer. Se
   * avisa en las DOS direcciones —me pagaron, o registraron que yo pagué—
   * porque en ambas alguien tocó mi saldo sin que yo estuviera mirando.
   *
   * T-186 sacó el acuse (T-064): ya no hay `settlement_pending` ni
   * `requiereConfirmacion` — todo saldo ajeno que me involucra es `settled`,
   * sin la rama que antes distinguía quién cobra en un grupo `consensus`.
   */
  const conocidos_pagos = new Set(before.paymentIds);
  const saldos: Notice[] = paymentsAfter
    .filter(p =>
      !p.isDeleted &&
      !conocidos_pagos.has(p.id) &&
      mios.has(p.groupId) &&
      !esMio(p.createdById) &&
      (esMio(p.fromUserId) || esMio(p.toUserId)))
    .map((p): Notice => ({
      kind: 'settled' as const,
      groupId: p.groupId,
      groupName: nombre(p.groupId),
      amount: p.amount,
      currency: p.currency,
    }));

  const traspasos: Notice[] = [];
  for (const g of groups) {
    if (g.isDeleted || !g.supersededByGroupId) continue;
    const yaLoSabia = before.traspasosConocidos[g.id] === g.supersededByGroupId;
    if (yaLoSabia) continue;

    const nuevo = groups.find(x => x.id === g.supersededByGroupId);
    traspasos.push({
      kind: 'group_replaced',
      groupId: g.id,
      groupName: g.name,
      newGroupId: g.supersededByGroupId,
      newGroupName: nuevo?.name ?? '',
    });
  }

  /**
   * Comentarios nuevos (T-194). Un comentario no sabe a qué grupo pertenece
   * —cuelga del gasto (mismo criterio que `commentStore.ts`)— así que el
   * grupo sale de buscar el gasto en `expensesAfter`: si ese gasto no es de
   * ninguno de mis grupos (`mios`), tampoco lo es el comentario.
   */
  const conocidosComentarios = new Set(before.commentIds ?? []);
  const grupoDelGasto = new Map(expensesAfter.map(e => [e.id, e.groupId]));
  const nuevosComentariosPorGrupo = new Map<string, number>();

  for (const c of commentsAfter) {
    if (c.isDeleted) continue;
    // Regla 1: lo que comenté yo no se avisa, aunque vuelva por el sync.
    if (esMio(c.authorId)) continue;
    // Regla 3: sólo lo que apareció en ESTA bajada.
    if (conocidosComentarios.has(c.id)) continue;

    const groupId = grupoDelGasto.get(c.expenseId);
    if (!groupId || !mios.has(groupId)) continue;

    nuevosComentariosPorGrupo.set(groupId, (nuevosComentariosPorGrupo.get(groupId) ?? 0) + 1);
  }

  // Regla 2: uno por grupo con el total, no uno por comentario.
  const porComentarios: Notice[] = [...nuevosComentariosPorGrupo.entries()].map(([groupId, count]) => ({
    kind: 'comment' as const,
    groupId,
    groupName: nombre(groupId),
    count,
  }));

  return [...porGastos, ...restauraciones, ...saldos, ...traspasos, ...porComentarios];
}
