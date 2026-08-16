import type { SimpleStorage } from '@/src/utils/createStorage';

/**
 * Fusión de datos entre dos cuentas del MISMO usuario en este device.
 *
 * Hace falta porque los stores se persisten namespaceados por id de cuenta
 * (`userScope`): si dos proveedores (Google / Apple) abrieron cuentas separadas
 * y después se descubre que son la misma persona, reapuntar la identidad SIN
 * mover los datos los deja invisibles — el usuario abre la app y ve todo vacío.
 * (Eso fue exactamente el defecto que hundió el primer intento de T-019.)
 *
 * La fusión es **unión con Last-Write-Wins por `updatedAt`**, la misma semántica
 * que ya usa el sync P2P (`mergeGroups`/`mergeExpenses`/…): ante dos versiones
 * del mismo registro gana la más nueva, y nada se descarta.
 *
 * No borra el scope de origen: si algo sale mal, los datos siguen ahí.
 */

type Syncable = { id: string; updatedAt: number };

function scopedKey(base: string, uid: string): string {
  return `${base}::u:${uid}`;
}

function readList(storage: SimpleStorage, base: string, uid: string): Syncable[] {
  const raw = storage.getString(scopedKey(base, uid));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Syncable[]) : [];
  } catch {
    return []; // scope corrupto: se ignora, no tumba la fusión de los demás
  }
}

/**
 * Une dos listas por id quedándose con el `updatedAt` mayor.
 * Exportada aparte para poder testear la regla sin storage de por medio.
 */
export function mergeById<T extends Syncable>(base: T[], incoming: T[]): T[] {
  const out = [...base];
  for (const inc of incoming) {
    const i = out.findIndex(x => x.id === inc.id);
    if (i === -1) out.push(inc);
    else if (inc.updatedAt > out[i].updatedAt) out[i] = inc;
  }
  return out;
}

export type MergeReport = {
  /** base → cuántos registros quedaron en el destino tras la fusión. */
  counts: Record<string, number>;
  /** true si el origen no tenía absolutamente nada que aportar. */
  sourceWasEmpty: boolean;
};

/**
 * Fusiona el scope `fromUid` dentro de `toUid` para cada store indicado.
 * `stores` es una lista de [storage, claveBase] — el llamador decide cuáles,
 * así este módulo no importa los stores y se puede testear aislado.
 */
export function mergeAccountData(
  stores: Array<[SimpleStorage, string]>,
  fromUid: string,
  toUid: string,
): MergeReport {
  const counts: Record<string, number> = {};
  let sourceWasEmpty = true;

  if (fromUid === toUid) return { counts, sourceWasEmpty };

  for (const [storage, base] of stores) {
    const from = readList(storage, base, fromUid);
    const to = readList(storage, base, toUid);

    if (from.length > 0) sourceWasEmpty = false;
    if (from.length === 0) {
      counts[base] = to.length;
      continue;
    }

    const merged = mergeById(to, from);
    storage.set(scopedKey(base, toUid), JSON.stringify(merged));
    counts[base] = merged.length;
  }

  return { counts, sourceWasEmpty };
}
