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
 * colaborativo (`updatedAt`, `isDeleted`, `deletedById`, …) queda AFUERA a
 * propósito: lo escriben terceros que no tienen la privada del autor.
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
  /**
   * Hash del contenido de `avatar` (Task 9) — permite que la rebanada `users`
   * (`relaySync.ts`) referencie la foto sin reenviar sus bytes en cada
   * publicación. La foto real viaja aparte, en su propio topic derivado del
   * digest (`avatarTopic.ts`), y se pide bajo demanda cuando este digest no
   * coincide con lo que ya está guardado localmente.
   *
   * Deliberadamente AJENO a la semántica de tres vías de `avatar`
   * (ausente = conservar, `null` = tombstone, string = adoptar) — ver
   * `userAvatar.ts#preservarAvatar`, que sólo mira `avatar` y nunca este
   * campo. Cuando `relaySync.ts` elide `avatar` para mandar sólo el digest,
   * lo hace con `undefined` (ausente), no con `null`: `null` sigue
   * reservado al tombstone real de T-074. Usar `null` acá haría que
   * cualquier rebanada con foto se leyera como si el dueño se la hubiera
   * sacado, borrando la copia que cada peer ya tenía cacheada.
   */
  avatarDigest?: string;
  /**
   * `'guest'` (T-101-bis): sesión sin Google/Apple, para usar la app sin cuenta
   * externa. Sync y todo lo demás funcionan igual — el buzón acepta clave `anon`
   * (`supabase/001_mailbox.sql`) y no depende de ningún proveedor. Sólo se queda
   * afuera del directorio de claves de ADR-004 (`deviceKeys.ts`), que exige un
   * `id_token` real; eso resuelve en `sin_directorio`, un veredicto que
   * `authorHealth.ts` nunca usa para rechazar (ver `RECHAZAR_AUTORES_NO_VERIFICADOS`).
   */
  authProvider: 'google' | 'apple' | 'guest';
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
  /**
   * Derivado de `miembros` (T-182): `rosterDe(miembros)`, los `'in'`. NADIE
   * lo escribe a mano — se recalcula en el merge (`mergeGroupsPure`) y al
   * escribir (`conAlta`/`conBaja`, `src/algorithms/roster.ts`). Sigue
   * existiendo para que todos los lectores actuales (balances, splits,
   * listas) queden iguales.
   */
  memberIds: string[];
  /**
   * Roster por miembro (T-182): reemplaza a `memberIds` como fuente de
   * verdad de quién está adentro. Se une POR CLAVE (gana el `at` mayor,
   * tope de reloj T-144) — no por lista entera como `memberIds` antes, que
   * podía "revivir" a quien ya salió si un tercero, sin ver la salida,
   * republicaba una lista vieja con `updatedAt` más nuevo por otro motivo
   * (renombrar, agregar a otro). Sin compatibilidad hacia atrás: todo grupo
   * nace con `miembros`.
   */
  miembros: Record<string, { estado: 'in' | 'out'; at: number }>;
  currency: CurrencyCode;
  createdAt: number;
  createdById: string;
  /**
   * Modo de división por defecto del grupo.
   * undefined = sin configuración → se muestran las 3 opciones al crear un gasto.
   * Si está definido, se pre-selecciona ese modo pero se puede cambiar por gasto.
   */
  defaultSplitMode?: SplitMode;
  /** Pedido de salida pendiente. Ver `LeaveRequest`. */
  leaveRequest?: LeaveRequest;
  /**
   * Este grupo se traspasó a otro por el límite de gastos (T-058, PO
   * 2026-09-20) — apunta al id del grupo nuevo. Optativo y aditivo: un
   * grupo sin este campo simplemente no fue traspasado. Dispara el aviso
   * `group_replaced` (`src/services/syncNotices.ts`) para los demás
   * miembros cuando aparece en una bajada de sync.
   */
  supersededByGroupId?: string;
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
  /**
   * Quién editó por última vez, si no fue el autor (T-185). Adentro del
   * núcleo (`recordCore.ts`): la reedición la firma quien edita, y la
   * verificación (`authorOf`, `src/sync/signOnWrite.ts`) toma como firmante
   * `editedById ?? createdById`. `createdById` no se toca nunca — sigue
   * siendo quien cargó el gasto. Ausente cuando el autor es quien editó por
   * última vez (incluida la creación).
   */
  editedById?: string;
  note?: string;
  receiptImageUri?: string;
  /**
   * Quién borró / restauró por última vez (T-186, opción B). Campo del nivel
   * «resto»: LWW, sin firma, falsificable por cualquier co-miembro — es una
   * etiqueta para Actividad, no una prueba. Lo escriben `app/expense/[id].tsx`
   * (al borrar) y `useRestoreExpense` (al restaurar); cada uno limpia el otro.
   */
  deletedById?: string;
  restoredById?: string;
  /**
   * Núcleos competidores en disputa (T-170 · D-2, enmienda de disputa firmada
   * — ronda 2). La escribe el merge, no el usuario: es una unión colaborativa
   * (`src/algorithms/autoria.ts`, `unirDisputa`) de las versiones del núcleo
   * que trajeron `createdById` distinto entre sí. El merge SÓLO une contenido
   * —nunca verifica firmas (D9)—, así que esto puede traer basura o un `id`
   * sin firma con formato de núcleo pero sin `k`/`s` reales.
   *
   * Lo que decide si hay disputa DE VERDAD vive afuera del merge, en
   * `src/sync/autoriaTrust.ts` (`enDisputa`/`autoresVerificados`): cuenta sólo
   * los núcleos cuya firma cierra contra la clave conocida de su autor. Antes
   * (ronda 1) esto era `string[]` de ids sueltos y bastaba inyectar un id para
   * abrir una disputa irreversible sin tocar el núcleo — el verifier lo marcó
   * (T-170 D-3 del dictamen) y el PO lo cerró exigiendo que la disputa quede
   * firmada y atribuible.
   */
  autoriaDisputada?: NucleoDisputado[];
}

/**
 * Snapshot de un núcleo COMPETIDOR de un gasto, capturado por el merge en el
 * momento en que ve dos versiones con `createdById` distinto (T-170 D-2/D3).
 *
 * Son los mismos campos que `EXPENSE_SLOTS` clasifica `'core'` en
 * `src/sync/recordCore.ts` + la firma (`k`/`s`), para poder reverificar la
 * firma de ESE lado de forma independiente, afuera del merge. Es un
 * duplicado deliberado de esa clasificación (no se importa `recordCore.ts`
 * desde acá para no crear un ciclo `models.ts` ⇄ `recordCore.ts`); si
 * `EXPENSE_SLOTS` gana un campo `core` nuevo, este tipo hay que actualizarlo
 * a mano — lo marca `recordCore.test.ts`.
 */
export interface NucleoDisputado {
  id: string;
  groupId: string;
  description: string;
  amount: number;
  currency: CurrencyCode;
  paidById: string;
  payers?: Payer[];
  splits: Split[];
  splitMode: SplitMode;
  category: ExpenseCategory;
  date: number;
  createdAt: number;
  createdById: string;
  note?: string;
  rev: number;
  k: string;
  s: string;
}

// Payment = liquidación de deuda. No necesita consenso.
// T-186: se sacó el acuse de recibo (T-064) junto con el modo «con acuerdo»
// — un saldado declarado cuenta al instante, sin confirmación de quien cobra.
// Ver docs/CONSENSO-PENDIENTE.md.
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
