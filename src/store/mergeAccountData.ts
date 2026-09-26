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
 */

export type ReglaDeFusion = CoreKind | 'lww';
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
