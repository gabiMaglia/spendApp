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
   */
  avatar?: string;
  authProvider: 'google' | 'apple';
  createdAt: number;
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

export interface DeletionVote {
  userId: string;
  votedAt: number;
  action: 'delete' | 'cancel';
  forced?: boolean; // solo el creador puede marcar forced=true
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

export interface LeaveRequest {
  /** Quién se va. */
  userId: string;
  /** Los pagos que dejarían su saldo en cero. Ver `planAbsorption`. */
  plan: { fromUserId: string; toUserId: string; amount: number; currency: CurrencyCode }[];
  requestedAt: number;
  /**
   * Quiénes ya aprobaron. Es un conjunto que sólo CRECE, y por eso se puede
   * unir sin perder nada cuando dos personas aprueban sin haberse sincronizado
   * — si se resolviera por LWW como el resto del registro, una de las dos
   * aprobaciones se perdería y el pedido no se completaría nunca.
   */
  approvedBy: string[];
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
