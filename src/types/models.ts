import type { CurrencyCode } from '@/src/constants/currencies';

// ── Sync meta — obligatorio en toda entidad persistida ──────────────────────
export interface SyncMeta {
  id: string;          // UUID generado en el cliente
  updatedAt: number;   // Unix ms — define quién gana en conflictos LWW
  isDeleted: boolean;  // Tombstone — nunca hacer DELETE físico
}

/**
 * Firma del NÚCLEO del registro por su autor (T-041).
 *
 * Los tres campos son opcionales y así se quedan: todo lo que existe desde
 * antes de T-041 llega sin ellos y tiene que seguir entrando (R2 del PO,
 * opción A — el histórico no se re-firma).
 *
 * Qué cubre la firma lo decide `src/sync/recordCore.ts`, campo por campo. Lo
 * colaborativo (`updatedAt`, `isDeleted`, `deletionVotes`, …) queda AFUERA a
 * propósito: lo escriben terceros que no tienen la privada del autor, y
 * meterlo adentro rompería el borrado consensuado el primer día.
 */
export interface CoreSigned {
  /**
   * Contador del núcleo, que **sólo sube el autor** y va ADENTRO de la firma.
   *
   * Hace falta porque `updatedAt` está afuera y por lo tanto es libre para
   * cualquiera: sin `rev`, un tercero toma un núcleo firmado viejo, lo
   * re-estampa con `updatedAt` mayor y gana el LWW con datos viejos — y la
   * firma sigue siendo la verdadera del autor, así que ninguna verificación lo
   * detecta. Ausente = 0 (todo lo de hoy), que es el comportamiento actual.
   *
   * Quién lo usa para ordenar el merge es S7; hasta entonces sólo se firma.
   */
  rev?: number;
  /** Pública Ed25519 de quien firmó el núcleo. Va inline, como en el sobre. */
  k?: string;
  /** Firma sobre el núcleo canónico. */
  s?: string;
}

// ── Entidades ────────────────────────────────────────────────────────────────
export interface User extends SyncMeta {
  name: string;
  email: string;
  username?: string;
  /** URL del proveedor. Sirve UNA vez, para sembrar `avatar`; después no se usa. */
  avatarUrl?: string;
  /**
   * Foto de perfil como data URI, ya achicada (96×96 JPEG, ~4-6 KB).
   *
   * Son BYTES y no una URL a propósito: una URL de Google haría que cada peer
   * bajara la imagen de su CDN, contándole a Google quién mira a quién. Ver
   * `src/services/avatar.ts`.
   *
   * **`null` NO es lo mismo que ausente.** Ausente significa «no traigo foto» y
   * la regla de T-056 conserva la que había; `null` es un **tombstone**: «esta
   * persona se sacó la foto». Es el mecanismo que `userAvatar.ts` dejó previsto
   * y que el borrado de cuenta (T-074) es el primero en usar.
   */
  avatar?: string | null;
  authProvider: 'google' | 'apple';
  createdAt: number;
  /**
   * Cuándo esta persona borró su cuenta (T-074).
   *
   * **Existe para que el cartel se lea en el idioma del que MIRA.** Sin esto,
   * `anonymizeSelf` escribe el texto ya resuelto en el idioma del que se borra
   * —«Cuenta borrada»— y un peer con la app en portugués lo ve en español para
   * siempre. Con la fecha, cada teléfono renderiza el suyo (`getUserName`).
   *
   * Campo opcional y aditivo: **un peer que no actualizó lo ignora** y sigue
   * viendo el nombre literal. No hay migración ni versión que subir.
   */
  deletedAt?: number;
}

/**
 * Plantilla de gasto recurrente (alquiler, servicios, suscripciones).
 *
 * Es una PLANTILLA, no un gasto con bandera: cada vencimiento produce un
 * `Expense` propio, con su fecha, que se puede editar o borrar sin tocar la
 * serie. `lastMaterializedAt` es lo que hace idempotente la materialización.
 */
export interface RecurringExpense extends SyncMeta, CoreSigned {
  groupId: string;         // '' = movimiento personal
  description: string;
  amount: number;          // entero en menor unidad (ADR-002)
  currency: CurrencyCode;
  paidById: string;
  /** Desglose cuando el gasto lo ponen entre varios. Ver `expensePayers()`. */
  payers?: Payer[];
  splitMode: SplitMode;
  splitValues?: number[];  // para percentage / shares / custom
  memberIds: string[];     // participantes al momento de crear la plantilla
  category: ExpenseCategory;
  rule: RecurrenceRule;
  /** Último vencimiento ya convertido en gasto. null = ninguno todavía. */
  lastMaterializedAt: number | null;
  isActive: boolean;       // el usuario puede pausar sin borrar
  createdAt: number;
  createdById: string;
}

export interface RecurrenceRule {
  frequency: 'weekly' | 'fortnightly' | 'monthly' | 'yearly';
  startDate: number;
  endDate?: number;
}

/**
 * Comentario en un gasto.
 *
 * Es una entidad PROPIA y no un array dentro de `Expense` a propósito: el merge
 * del sync es LWW por registro, así que si dos personas comentan el mismo gasto
 * antes de sincronizar y los comentarios vivieran dentro del gasto, ganaría uno
 * y el otro se perdería sin aviso. Como registros separados con id propio, los
 * dos sobreviven.
 */
/** Cuánto puso una persona en un gasto que pagaron entre varios. */
export interface Payer {
  userId: string;
  amount: number;   // entero en menor unidad (ADR-002)
}

export interface ExpenseComment extends SyncMeta, CoreSigned {
  expenseId: string;
  authorId: string;
  text: string;
  createdAt: number;
}

/**
 * Un voto de la ronda de borrado (regla de negocio #2).
 *
 * **Cuatro acciones** desde T-041 · S8 (R-Q1/R-Q2 del PO): pedir el borrado,
 * objetarlo, retirar el pedido propio y restaurar un gasto ya borrado. La
 * acción semántica se lee con `accionDe()` (`src/sync/voteCore.ts`) y NO
 * directamente de `action`, porque las cuatro no entran en un solo campo sin
 * romper a los peers que no actualizaron:
 *
 * - `action` es el token que lee un peer viejo, que sólo conoce `delete` y
 *   `cancel`. Objetar y restaurar viajan los dos como `cancel` — allá las dos
 *   tienen que frenar, y una acción que ese lado no conoce es un voto que no
 *   frena nada: el gasto se borraría solo en su teléfono y el tombstone
 *   volvería por el sync.
 * - `intent` distingue restaurar de objetar para el que sí actualizó. Ausente
 *   = objetar, que es lo que emiten los peers viejos y lo que emitimos nosotros
 *   al objetar.
 * - `withdraw` sí puede ser un token propio: para un peer viejo es un voto que
 *   no dice nada, y "no dice nada" es justo el resultado correcto — retirar
 *   saca el pedido de su autor por el colapso por persona, y no frena a nadie
 *   más.
 *
 * `roundId`, `k` y `s` son opcionales por R2: lo viejo y lo de un peer sin
 * actualizar sigue entrando y sigue contando.
 */
export interface DeletionVote {
  userId: string;
  votedAt: number;
  /** Token de compatibilidad. La acción semántica sale de `accionDe()`. */
  action: 'delete' | 'cancel' | 'withdraw';
  /** Qué frenó exactamente un `cancel`. Ausente = objetar. */
  intent?: 'restore';
  /** Contra qué ronda se emitió. Va ADENTRO de la firma. */
  roundId?: string;
  forced?: boolean; // solo el creador puede marcar forced=true
  /** Pública del firmante del voto (T-041 · S8). */
  k?: string;
  /** Firma del enunciado del voto, no del conjunto. Ver `voteCore.ts`. */
  s?: string;
}

/**
 * Pedido de salida con saldo abierto (regla de negocio del PO).
 *
 * Irse debiendo no es gratis: esa plata la pierde alguien. Por eso el que se va
 * propone QUIÉN absorbe y CUÁNTO, y **todos los que quedan tienen que aprobar**
 * antes de que se aplique. Vive en el `Group` para que viaje por el sync como
 * cualquier otro campo.
 */
export type DeletionMode = 'consensus' | 'open';

/**
 * La aprobación FIRMADA de una salida (T-065).
 *
 * Antes esto era un `string` pelado con el id del que aprobaba, y ahí estaba el
 * agujero: el conjunto se une en el merge sin preguntar quién escribió cada id,
 * así que **el que se iba podía escribir los ids de todos los demás** y
 * auto-aprobarse la salida. Eso dispara `applyApprovedLeaves` en el teléfono de
 * todos y materializa los pagos de absorción: plata moviéndose con cero
 * autorización. Reproducido con test antes de tocar nada.
 */
export interface LeaveApproval {
  /** Quién aprueba. */
  userId: string;
  /** `syncedNow()` (ADR-005), nunca `Date.now()` — ver T-059. */
  approvedAt: number;
  /** Pública del firmante (T-041). */
  k?: string;
  /** Firma del enunciado de ESTA aprobación, no del conjunto. */
  s?: string;
}

/**
 * Una entrada del conjunto de aprobaciones.
 *
 * El `string` es lo que manda un peer anterior a T-065. Se conserva para no
 * trabar una salida en curso, y sólo cuenta en pedidos viejos: ver `v`.
 */
export type ApprovalEntry = string | LeaveApproval;

export interface LeaveRequest {
  /** Quién se va. */
  userId: string;
  /** Los pagos que dejarían su saldo en cero. Ver `planAbsorption`. */
  plan: { fromUserId: string; toUserId: string; amount: number; currency: CurrencyCode }[];
  requestedAt: number;
  /**
   * Versión del pedido. Ausente = anterior a T-065, donde las aprobaciones no
   * estaban firmadas y no había forma de exigirlo sin trabar salidas en curso.
   *
   * **En un pedido `v: 2` sólo cuentan las aprobaciones que VERIFICAN.** Es el
   * mismo patrón que las rondas de borrado de T-041 S8: lo nuevo es seguro
   * desde el primer día y lo viejo se vence solo, en vez de una migración que
   * rompa a quien esté a mitad de camino.
   */
  v?: 2;
  /**
   * Quiénes ya aprobaron. Es un conjunto que sólo CRECE, y por eso se puede
   * unir sin perder nada cuando dos personas aprueban sin haberse sincronizado
   * — si se resolviera por LWW como el resto del registro, una de las dos
   * aprobaciones se perdería y el pedido no se completaría nunca.
   */
  approvedBy: ApprovalEntry[];
}

export interface Group extends SyncMeta, CoreSigned {
  name: string;
  memberIds: string[];
  currency: CurrencyCode;
  createdAt: number;
  createdById: string;
  deletionVotes: DeletionVote[];
  /**
   * Cómo se borran los gastos de este grupo. Se elige al crearlo (decisión del
   * PO 2026-08-30) y no cambia después: aflojarlo más tarde relajaría en
   * retroactivo un acuerdo que el grupo ya había tomado.
   *
   * - `consensus` (default): regla #2 — pedir, 72hs para objetar, override del
   *   creador. Es lo que hace este proyecto desde siempre.
   * - `open`: como Splitwise — cualquiera del grupo borra al instante y
   *   cualquiera restaura desde Actividad. La defensa no es impedir sino ver y
   *   poder deshacer.
   *
   * Opcional a propósito: los grupos que existen desde antes no lo tienen y
   * caen a `consensus`, que es el modo más restrictivo. Nunca se aflojan solos.
   */
  deletionMode?: DeletionMode;
  /**
   * Modo de división por defecto del grupo.
   * undefined = sin configuración → se muestran las 3 opciones al crear un gasto.
   * Si está definido, se pre-selecciona ese modo pero se puede cambiar por gasto.
   */
  defaultSplitMode?: SplitMode;
  /** Pedido de salida pendiente. Ver `LeaveRequest`. */
  leaveRequest?: LeaveRequest;
}

export type ExpenseCategory =
  | 'food' | 'transport' | 'accommodation' | 'entertainment'
  | 'utilities' | 'health' | 'shopping' | 'other';

/**
 * Modos de división de un gasto:
 * - 'equal'      → Partes iguales: el total se divide por la cantidad de miembros.
 * - 'percentage' → Porcentaje: cada persona especifica su %. Deben sumar 100.
 * - 'custom'     → Personalizado: cada persona especifica su monto. El último
 *                  miembro recibe automáticamente el resto (total − suma de los demás).
 */
export type SplitMode = 'equal' | 'percentage' | 'shares' | 'custom';

export interface Split {
  userId: string;
  amount: number;
  isPaid: boolean;
}

export interface Expense extends SyncMeta, CoreSigned {
  groupId: string;
  description: string;
  amount: number;
  currency: CurrencyCode;
  /**
   * Pagador principal. Se mantiene SIEMPRE (además de `payers`) porque el sync
   * es P2P y no se puede obligar a los otros devices a actualizar. Cuando hay
   * varios pagadores, apunta al que más puso.
   *
   * OJO — un peer que no actualizó ignora `payers` y le acredita el TOTAL a este
   * usuario, así que los dos dispositivos van a mostrar balances **distintos**
   * para ese gasto. No es "razonable", es una limitación real: no hay forma de
   * arreglarlo desde este lado. Lo que sí se hace es detectarlo
   * (`peerIsOutdated`, src/sync/useSyncQR.ts) y avisarle al usuario.
   */
  paidById: string;
  /**
   * Pagadores cuando el gasto lo pusieron entre varios. Opcional a propósito:
   * si falta (gasto viejo o de un peer sin actualizar) se deriva de `paidById`.
   * NO leer este campo directo — usar `expensePayers()` (src/algorithms/payers.ts),
   * que es la única fuente de verdad.
   */
  payers?: Payer[];
  splits: Split[];
  splitMode: SplitMode;
  category: ExpenseCategory;
  date: number;           // timestamp del gasto (no del registro)
  createdAt: number;
  createdById: string;
  note?: string;
  receiptImageUri?: string;
  deletionVotes: DeletionVote[];
}

// Payment = liquidación de deuda. No necesita consenso.
/**
 * El acuse de quien COBRA sobre un saldado (T-064).
 *
 * No es un campo de estado en el `Payment` a propósito: un `status` guardado
 * sería LWW y cualquier peer lo pisa republicando el registro con `updatedAt`
 * mayor. **Es exactamente T-053** —así viajaba el modo de borrado del grupo, y
 * cualquiera lo bajaba de `consensus` a `open`—. Acá el acuse es un aporte
 * colaborativo firmado, como los votos de borrado: se une, no se elige.
 */
export interface SettlementConfirmation {
  /** Quién acusa. Al derivar el estado sólo vale el del `toUserId`. */
  userId: string;
  /** `syncedNow()` (ADR-005), nunca `Date.now()` — ver T-059. */
  confirmedAt: number;
  action: 'confirm' | 'reject';
  /** Pública del firmante del acuse (T-041). */
  k?: string;
  /** Firma del enunciado del acuse, no del conjunto. */
  s?: string;
}

export interface Payment extends SyncMeta, CoreSigned {
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: CurrencyCode;
  targetCurrency?: CurrencyCode;
  exchangeRate?: number;
  date: number;
  createdAt: number;
  createdById: string;
  note?: string;
  /**
   * Acuses de recibo. Sólo se miran en grupos `consensus` y sólo cuando el pago
   * lo declaró quien paga: si lo declaró quien cobra, ya está dicho (D3).
   *
   * Fuera del núcleo firmado: lo escribe quien cobra, no el autor del pago.
   */
  confirmations?: SettlementConfirmation[];
}

// ── Gastos personales & presupuesto ──────────────────────────────────────────

export type PersonalEntryKind = 'expense' | 'income' | 'group_replicated' | 'carryover';

export type PersonalCategory = ExpenseCategory | 'income' | 'salary' | 'freelance';

export interface PersonalEntry extends SyncMeta {
  kind: PersonalEntryKind;
  description: string;
  amount: number;          // siempre positivo
  currency: CurrencyCode;
  category: PersonalCategory;
  date: number;
  createdAt: number;
  sourceGroupExpenseId?: string; // solo cuando kind === 'group_replicated'
  sourceGroupId?: string;
  sourceGroupName?: string;
  isPositiveCarryover?: boolean; // solo cuando kind === 'carryover'
}

export interface PersonalBudget {
  currency: CurrencyCode;
  monthlyAmount: number;    // 0 = sin presupuesto configurado
  includeOwedToMe: boolean; // si lo que me deben cuenta como parte del presupuesto
}

// ── Balance ──────────────────────────────────────────────────────────────────
export interface Balance {
  userId: string;
  amount: number; // positivo = acreedor, negativo = deudor
}

export interface BalanceByCurrency {
  userId: string;
  balances: { currency: CurrencyCode; amount: number }[];
}

export interface Transaction {
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: CurrencyCode;
}
