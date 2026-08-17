import type { CurrencyCode } from '@/src/constants/currencies';

// ── Sync meta — obligatorio en toda entidad persistida ──────────────────────
export interface SyncMeta {
  id: string;          // UUID generado en el cliente
  updatedAt: number;   // Unix ms — define quién gana en conflictos LWW
  isDeleted: boolean;  // Tombstone — nunca hacer DELETE físico
}

// ── Entidades ────────────────────────────────────────────────────────────────
export interface User extends SyncMeta {
  name: string;
  email: string;
  username?: string;
  avatarUrl?: string;
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
export interface RecurringExpense extends SyncMeta {
  groupId: string;         // '' = movimiento personal
  description: string;
  amount: number;          // entero en menor unidad (ADR-002)
  currency: CurrencyCode;
  paidById: string;
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

export interface ExpenseComment extends SyncMeta {
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

export interface Group extends SyncMeta {
  name: string;
  memberIds: string[];
  currency: CurrencyCode;
  createdAt: number;
  createdById: string;
  deletionVotes: DeletionVote[];
  /**
   * Modo de división por defecto del grupo.
   * undefined = sin configuración → se muestran las 3 opciones al crear un gasto.
   * Si está definido, se pre-selecciona ese modo pero se puede cambiar por gasto.
   */
  defaultSplitMode?: SplitMode;
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

export interface Expense extends SyncMeta {
  groupId: string;
  description: string;
  amount: number;
  currency: CurrencyCode;
  /**
   * Pagador principal. Se mantiene SIEMPRE (además de `payers`) porque el sync
   * es P2P y no se puede obligar a los otros devices a actualizar: un peer viejo
   * lee esto y sigue calculando balances razonables. Cuando hay varios
   * pagadores, apunta al que más puso.
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
export interface Payment extends SyncMeta {
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
