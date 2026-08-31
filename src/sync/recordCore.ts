import { canonical } from '@/src/store/lww';
import type {
  Expense, Payment, ExpenseComment, RecurringExpense, Group,
} from '@/src/types/models';

/**
 * **Qué se firma exactamente** (T-041 · S1).
 *
 * No se firma "el registro": se firma un núcleo enumerado CAMPO POR CAMPO. La
 * alternativa —"todo menos X"— tiene un modo de falla que este proyecto no se
 * puede permitir: el día que alguien agregue un campo al modelo, todas las
 * firmas viejas dejan de validar EN SILENCIO, y con la política del PO (R1: se
 * marca, no se rechaza) eso sería una app entera llena de marcas rojas sin que
 * nadie haya hecho nada malo.
 *
 * Por eso cada campo está clasificado a mano, adentro o afuera:
 *
 *  - **adentro** (`core`) va lo que decide plata y autoría, y lo que escribe
 *    únicamente el autor;
 *  - **afuera** (`fuera`) va todo lo que escriben terceros legítimamente
 *    (`updatedAt`, `isDeleted`, `deletionVotes`, `leaveRequest`,
 *    `lastMaterializedAt`) y lo que es local del aparato (`receiptImageUri`).
 *    Meter cualquiera de esos adentro rompería el borrado consensuado, la
 *    materialización de recurrentes o las dos.
 *
 * El tipo `Record<keyof X, CoreSlot>` obliga a clasificar en tiempo de
 * compilación; `recordCore.test.ts` lo vuelve a exigir en tiempo de test
 * leyendo `models.ts`, porque `tsc` y `jest` los corre gente distinta.
 *
 * **`k` y `s` quedan afuera por construcción**: una firma no puede cubrirse a
 * sí misma.
 */

export const CORE_KINDS = ['expense', 'payment', 'comment', 'recurring', 'group'] as const;
export type CoreKind = (typeof CORE_KINDS)[number];

export type CoreRecord = {
  expense: Expense;
  payment: Payment;
  comment: ExpenseComment;
  recurring: RecurringExpense;
  group: Group;
};

export type CoreSlot = 'core' | 'fuera';

/**
 * Versión del algoritmo del payload.
 *
 * **Congela** cómo se arma el mensaje firmado: qué campos entran, cómo se
 * serializan y qué envoltorio los rodea. Si cambia `canonical()` o cambia la
 * clasificación de un campo, esto sube y lo viejo se sigue verificando con lo
 * viejo. Va adentro del mensaje, así que una firma de la versión 1 no vale
 * como firma de la 2.
 */
export const CORE_VERSION = 1;

const EXPENSE_SLOTS: Record<keyof Expense, CoreSlot> = {
  id: 'core',
  groupId: 'core',
  description: 'core',
  amount: 'core',
  currency: 'core',
  paidById: 'core',
  payers: 'core',
  splits: 'core',        // incluye `isPaid`, que sólo se escribe al crear
  splitMode: 'core',
  category: 'core',
  date: 'core',
  note: 'core',
  createdAt: 'core',
  createdById: 'core',
  // `rev` va DENTRO de la firma, igual que en las otras cuatro entidades. Es la
  // razón de que exista (§5): sin él, un tercero toma un núcleo firmado válido,
  // lo re-estampa con un `rev` mayor y le gana al merge por niveles con datos
  // viejos. Estaba en 'fuera' — el único de los cinco — y el meta-test lo cazó.
  rev: 'core',

  updatedAt: 'fuera',       // lo bumpea cualquiera que vote un borrado
  isDeleted: 'fuera',       // tombstone: lo escriben terceros
  deletionVotes: 'fuera',   // unión de aportes de gente distinta
  receiptImageUri: 'fuera', // URI local del aparato, no un dato compartido
  k: 'fuera',
  s: 'fuera',
};

const PAYMENT_SLOTS: Record<keyof Payment, CoreSlot> = {
  id: 'core',
  groupId: 'core',
  fromUserId: 'core',
  toUserId: 'core',
  amount: 'core',
  currency: 'core',
  targetCurrency: 'core',
  exchangeRate: 'core',
  date: 'core',
  note: 'core',           // C.1e: el §1 lo había olvidado. Es del autor.
  createdAt: 'core',
  createdById: 'core',
  rev: 'core',

  updatedAt: 'fuera',
  isDeleted: 'fuera',
  k: 'fuera',
  s: 'fuera',
};

const COMMENT_SLOTS: Record<keyof ExpenseComment, CoreSlot> = {
  id: 'core',
  expenseId: 'core',
  authorId: 'core',
  text: 'core',
  createdAt: 'core',
  rev: 'core',

  updatedAt: 'fuera',
  isDeleted: 'fuera',
  k: 'fuera',
  s: 'fuera',
};

const RECURRING_SLOTS: Record<keyof RecurringExpense, CoreSlot> = {
  id: 'core',
  groupId: 'core',
  description: 'core',
  amount: 'core',
  currency: 'core',
  paidById: 'core',
  payers: 'core',
  splitMode: 'core',
  splitValues: 'core',
  memberIds: 'core',
  category: 'core',
  rule: 'core',
  isActive: 'core',      // pausa del usuario: hoy sólo la edita quien tiene la plantilla
  createdAt: 'core',
  createdById: 'core',
  rev: 'core',

  /**
   * Lo escribe CUALQUIER device al materializar (`materializeRecurring.ts` →
   * `session.ts`). Adentro del núcleo, la primera materialización de un tercero
   * invalidaría la firma del autor y la plantilla quedaría marcada para siempre.
   */
  lastMaterializedAt: 'fuera',
  updatedAt: 'fuera',
  isDeleted: 'fuera',
  k: 'fuera',
  s: 'fuera',
};

/**
 * Del grupo se firma **sólo la creación**.
 *
 * `memberIds`, `name`, `deletionMode` y `leaveRequest` los escribe cualquier
 * miembro por diseño: no hay una sola persona que pueda firmarlos sin mentir.
 * Protegerlos es un ticket propio (roster/admin firmado, riesgo 2 del §QUÉ);
 * `deletionMode` se cerró aparte como T-053.
 */
const GROUP_SLOTS: Record<keyof Group, CoreSlot> = {
  id: 'core',
  createdAt: 'core',
  createdById: 'core',
  rev: 'core',

  name: 'fuera',
  memberIds: 'fuera',
  currency: 'fuera',
  deletionVotes: 'fuera',
  deletionMode: 'fuera',
  defaultSplitMode: 'fuera',
  leaveRequest: 'fuera',
  updatedAt: 'fuera',
  isDeleted: 'fuera',
  k: 'fuera',
  s: 'fuera',
};

const SLOTS: { [K in CoreKind]: Record<keyof CoreRecord[K], CoreSlot> } = {
  expense: EXPENSE_SLOTS,
  payment: PAYMENT_SLOTS,
  comment: COMMENT_SLOTS,
  recurring: RECURRING_SLOTS,
  group: GROUP_SLOTS,
};

function camposCore(kind: CoreKind): readonly string[] {
  return Object.entries(SLOTS[kind] as Record<string, CoreSlot>)
    .filter(([, slot]) => slot === 'core')
    .map(([campo]) => campo);
}

const CORE_FIELDS: Record<CoreKind, readonly string[]> = {
  expense: camposCore('expense'),
  payment: camposCore('payment'),
  comment: camposCore('comment'),
  recurring: camposCore('recurring'),
  group: camposCore('group'),
};

/** La clasificación completa de una entidad, campo por campo. */
export function slotsOf(kind: CoreKind): Readonly<Record<string, CoreSlot>> {
  return SLOTS[kind] as Record<string, CoreSlot>;
}

/** Qué campos cubre la firma de esta entidad. */
export function coreFieldsOf(kind: CoreKind): readonly string[] {
  return CORE_FIELDS[kind];
}

/**
 * El payload que se firma.
 *
 * Lleva `v` (la versión que congela el algoritmo) y `t` (la entidad). Sin `t`,
 * un `Payment` y un `Expense` con los mismos valores producirían el MISMO
 * mensaje y una firma valdría para los dos — la misma clase de agujero que
 * `zip215:false` cierra un nivel más abajo.
 *
 * Un campo ausente no se inventa: `canonical()` descarta `undefined`, así que
 * un registro sin `rev` firma sin la clave `rev`, no con `rev: 0`.
 */
export function coreOf<K extends CoreKind>(
  kind: K, record: CoreRecord[K],
): Record<string, unknown> {
  const fuente = record as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { v: CORE_VERSION, t: kind };
  for (const campo of CORE_FIELDS[kind]) {
    // Un ausente y un presente-como-undefined tienen que dar lo mismo, o dos
    // devices que construyen el registro distinto firmarían mensajes distintos.
    if (fuente[campo] !== undefined) out[campo] = fuente[campo];
  }
  return out;
}

/** El mensaje exacto que firma el autor y verifica el lector. */
export function canonicalCore<K extends CoreKind>(kind: K, record: CoreRecord[K]): string {
  return canonical(coreOf(kind, record));
}
