import type { SimpleStorage } from '@/src/utils/createStorage';
import { mergeByIdLevels } from './mergeLevels';
import { mergeUsersLWW } from './mergeUsersLWW';
import type { CoreKind, CoreRecord } from '@/src/sync/recordCore';
import type { Syncable } from './lww';

/**
 * Fusión de datos entre dos cuentas del MISMO usuario en este device.
 *
 * Hace falta porque los stores se persisten namespaceados por id de cuenta
 * (`userScope`): si dos proveedores (Google / Apple) abrieron cuentas separadas
 * y después se descubre que son la misma persona, reapuntar la identidad SIN
 * mover los datos los deja invisibles — el usuario abre la app y ve todo vacío.
 * (Eso fue exactamente el defecto que hundió el primer intento de T-019.)
 *
 * **La fusión usa EXACTAMENTE el merge del sync, no una copia** (T-149,
 * TEC-03). Hasta el 2026-09-26 acá vivía un tercer LWW —registro entero por
 * `updatedAt`, sin desempate, sin unir votos ni acuses— y el docblock decía
 * «la misma semántica que el sync P2P», que era falso desde T-041. Fusionar
 * dos cuentas podía perder el voto de borrado o el acuse de saldado que sólo
 * estaba en la absorbida, y destruir la firma de un núcleo. Ahora cada store
 * declara su regla: las cinco entidades con núcleo van por `mergeByIdLevels`
 * (rev + colaborativo + LWW con tope); perfiles y personales por
 * `mergeUsersLWW` (LWW con tope). Si el merge del sync cambia, éste cambia
 * solo.
 *
 * No borra el scope de origen: si algo sale mal, los datos siguen ahí.
 * `now` se inyecta: este módulo es puro y no abre `syncedClock`.
 *
 * **Ronda 1 del verificador (D1/D2/D3).** «Cada store declara su regla» no
 * alcanzaba cuando la regla era sólo un `CoreKind`: el sync de varios stores
 * hace más que el merge desnudo (`expenseStore.mergeExpenses` preserva el
 * recibo, `groupStore.mergeGroups` deriva el roster, `userStore.
 * mergeUsers` preserva el avatar), y una fusión con `mergeByIdLevels`/
 * `mergeUsersLWW` a secas se saltea esos pasos. Por eso `ReglaDeFusion` acepta
 * también la función PURA que cada store exporta (`mergeExpensesPure`,
 * `mergeGroupsPure`, `mergeUsersPure`, `mergePersonalPure`): es literalmente
 * la misma función que usa `mergeExpenses`/`mergeGroups`/`mergeUsers`/
 * `mergeEntries`, así que si el sync le agrega un paso, la fusión lo hereda
 * sola. Un `CoreKind` sigue aceptado para los stores cuyo sync llama a
 * `mergeByIdLevels` desnudo y nada más (payment, recurring, comment): ahí
 * pasar el kind ES pasar la misma función.
 */

export type FusionFn = (current: Syncable[], incoming: Syncable[], now: number) => Syncable[];
export type ReglaDeFusion = CoreKind | 'lww' | FusionFn;
export type StoreAFusionar = [storage: SimpleStorage, base: string, regla: ReglaDeFusion];

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

function fusionar(regla: ReglaDeFusion, to: Syncable[], from: Syncable[], now: number): Syncable[] {
  if (typeof regla === 'function') return regla(to, from, now);
  if (regla === 'lww') return mergeUsersLWW(to, from, now);
  return mergeByIdLevels(
    regla,
    to as unknown as CoreRecord[typeof regla][],
    from as unknown as CoreRecord[typeof regla][],
    now,
  ) as unknown as Syncable[];
}

export type MergeReport = {
  /** base → cuántos registros quedaron en el destino tras la fusión. */
  counts: Record<string, number>;
  /** true si el origen no tenía absolutamente nada que aportar. */
  sourceWasEmpty: boolean;
};

/**
 * Fusiona el scope `fromUid` dentro de `toUid` para cada store indicado.
 * `stores` es una lista de [storage, claveBase, regla] — el llamador decide
 * cuáles y con qué regla, así este módulo no importa los stores y se puede
 * testear aislado.
 */
export function mergeAccountData(
  stores: StoreAFusionar[],
  fromUid: string,
  toUid: string,
  now: number,
): MergeReport {
  const counts: Record<string, number> = {};
  let sourceWasEmpty = true;

  if (fromUid === toUid) return { counts, sourceWasEmpty };

  for (const [storage, base, regla] of stores) {
    const from = readList(storage, base, fromUid);
    const to = readList(storage, base, toUid);

    if (from.length > 0) sourceWasEmpty = false;
    if (from.length === 0) {
      counts[base] = to.length;
      continue;
    }

    const merged = fusionar(regla, to, from, now);
    storage.set(scopedKey(base, toUid), JSON.stringify(merged));
    counts[base] = merged.length;
  }

  return { counts, sourceWasEmpty };
}
