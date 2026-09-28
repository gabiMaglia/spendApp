import type { CoreKind, CoreRecord } from './recordCore';

/**
 * **Los registros que nadie puede firmar por diseño** (T-041 · S6, decisión D4
 * del PO).
 *
 * Hay dos clases que no van a estar firmadas nunca, en ningún dispositivo,
 * porque el device que las crea no es el autor y no tiene con qué firmarlas:
 *
 *  1. los `Payment` de `applyApprovedLeaves` (`applyLeave.ts`): el `createdById`
 *     es el del que SE VA, y la resolución corre en el teléfono de cualquiera;
 *  2. los `Expense` de `materializeRecurring`: los emite el primer device que
 *     abre la app después del vencimiento, no el autor de la plantilla.
 *
 * El PO decidió que **no se cuentan como `no_verificable` ni se descartan en
 * silencio**: van a una categoría propia y visible, porque que una parte del
 * libro contable sea estructuralmente inatribuible es justo lo que hay que tener
 * a la vista — y es la métrica que va a decir cuándo S9 lo resolvió de verdad
 * (`derivedFrom` para los pagos de salida, y lo mismo para los recurrentes, que
 * el plan no tenía escrito hasta D5).
 *
 * **Por qué no alcanza con "no tiene firma".** Un registro anterior a T-041
 * tampoco la tiene, y ése SÍ es `no_verificable` (R2, opción A: el histórico no
 * se re-firma). Lo que separa a los dos es la **forma**: las dos clases derivadas
 * tienen id determinista, y ese id **promete campos del registro**. Acá se
 * exigen esas promesas en vez de confiar en el prefijo:
 *
 *  - `leave:<groupId>:<userId>:<requestedAt>:<i>` tiene que cerrar contra
 *    `groupId` y `createdById` del propio pago;
 *  - `rec_<templateId>_<vencimiento>` tiene que cerrar contra `date` y
 *    `createdAt`, que `materializeRecurring` ancla al vencimiento a propósito.
 *
 * Sin ese cierre el prefijo sería gratis: cualquiera escondería un registro
 * ajeno en la cuarta categoría y el número que D4 existe para mirar dejaría de
 * significar algo.
 *
 * **Límite declarado, y es real:** el autor de un pago de salida puede fabricar
 * uno a su propio nombre con un `requestedAt` inventado y quedar en
 * `no_firmable` en vez de en el veredicto que le tocaría. Cerrarlo de verdad es
 * S9 —verificar el pago contra el `LeaveRequest` firmado— y hasta entonces el
 * techo de este módulo es la coherencia interna del id.
 */

export type DerivedOrigin = 'leave' | 'recurring';

/** `leave:<groupId>:<userId>:<requestedAt>:<i>` — `applyLeave.ts:36-38`. */
const PARTES_LEAVE = 5;

const SOLO_DIGITOS = /^\d+$/;

function campo(record: unknown, nombre: string): unknown {
  return (record as Record<string, unknown> | null)?.[nombre];
}

function texto(record: unknown, nombre: string): string | undefined {
  const v = campo(record, nombre);
  return typeof v === 'string' ? v : undefined;
}

/** Un pago de absorción de deuda, sólo si su id cierra contra el propio pago. */
function esPagoDeSalida(record: unknown): boolean {
  const id = texto(record, 'id');
  if (!id) return false;

  const p = id.split(':');
  if (p.length !== PARTES_LEAVE || p[0] !== 'leave') return false;
  if (!SOLO_DIGITOS.test(p[3]!) || !SOLO_DIGITOS.test(p[4]!)) return false;

  return p[1] === texto(record, 'groupId') && p[2] === texto(record, 'createdById');
}

/**
 * Un gasto materializado, sólo si el vencimiento que promete su id es la fecha
 * del gasto.
 *
 * Se corta por el ÚLTIMO `_` porque el id de la plantilla puede tener guiones
 * bajos adentro y el vencimiento nunca los tiene.
 */
function esGastoMaterializado(record: unknown): boolean {
  const id = texto(record, 'id');
  if (!id || !id.startsWith('rec_')) return false;

  const corte = id.lastIndexOf('_');
  if (corte <= 'rec_'.length - 1) return false;

  const vencimiento = id.slice(corte + 1);
  if (!SOLO_DIGITOS.test(vencimiento)) return false;

  const at = Number(vencimiento);
  return campo(record, 'date') === at && campo(record, 'createdAt') === at;
}

/**
 * De qué clase derivada es este registro, o `null` si es uno normal.
 *
 * Pura y síncrona: la llama el merge, que no puede hacer red (§3 del plan).
 */
export function derivedOriginOf<K extends CoreKind>(
  kind: K, record: CoreRecord[K],
): DerivedOrigin | null {
  if (kind === 'payment' && esPagoDeSalida(record)) return 'leave';
  if (kind === 'expense' && esGastoMaterializado(record)) return 'recurring';
  return null;
}
