import type { CoreKind, CoreRecord } from './recordCore';

/**
 * **Los registros que nadie puede firmar por diseño** (T-041 · S6, decisión D4
 * del PO).
 *
 * Hoy queda una sola clase: los `Expense` de `materializeRecurring`. Los emite
 * el primer device que abre la app después del vencimiento, no el autor de la
 * plantilla, así que no tiene con qué firmarlos. (Los pagos de absorción de
 * salida, `leave:`, fueron la otra clase hasta T-228: ya no hay absorción.)
 *
 * El PO decidió que **no se cuentan como `no_verificable` ni se descartan en
 * silencio**: van a una categoría propia y visible (`no_firmable`), porque que
 * una parte del libro contable sea estructuralmente inatribuible es justo lo
 * que hay que tener a la vista.
 *
 * **Por qué no alcanza con "no tiene firma".** Un registro anterior a T-041
 * tampoco la tiene, y ése SÍ es `no_verificable`. Lo que separa a los dos es la
 * **forma**: `rec_<templateId>_<vencimiento>` tiene que cerrar contra `date` y
 * `createdAt`, que `materializeRecurring` ancla al vencimiento a propósito. Sin
 * ese cierre el prefijo sería gratis: cualquiera escondería un registro ajeno
 * en esta categoría.
 */

export type DerivedOrigin = 'recurring';

const SOLO_DIGITOS = /^\d+$/;

function campo(record: unknown, nombre: string): unknown {
  return (record as Record<string, unknown> | null)?.[nombre];
}

function texto(record: unknown, nombre: string): string | undefined {
  const v = campo(record, nombre);
  return typeof v === 'string' ? v : undefined;
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
  if (kind === 'expense' && esGastoMaterializado(record)) return 'recurring';
  return null;
}
