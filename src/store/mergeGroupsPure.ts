import { mergeByIdLevels } from './mergeLevels';
import { rosterDe } from '@/src/algorithms/roster';
import type { Group } from '@/src/types/models';

function mismoRoster(a: readonly string[] | undefined, b: readonly string[]): boolean {
  // `a` puede venir `undefined`: un `Group` de antes de T-182 que nunca pasó
  // por `addGroup`/`conAlta` (por ejemplo, un fixture de test que arma el
  // registro a mano). Tratarlo como "distinto de cualquier roster no vacío"
  // es lo correcto: hay algo que recalcular.
  return !!a && a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Merge puro de grupos: por niveles, más el roster derivado.
 *
 * Vive en su propio módulo (T-149 · D2 verifier) y no adentro de
 * `groupStore.ts` a propósito: ese store importa `relayEngine` (para
 * `schedulePublish`), que arrastra el relay, `authorHealth` y `deviceKeys`.
 * `accountLink.mergeAccounts` necesita esta función para fusionar cuentas SIN
 * arrastrar esa cadena — sólo `mergeByIdLevels`, que es puro. `groupStore.
 * mergeGroups` importa esta MISMA función; no hay una segunda copia en
 * ningún lado.
 */
export function mergeGroupsPure(current: Group[], incoming: Group[], now: number): Group[] {
  return mergeByIdLevels('group', current, incoming, now).map(g => {
    // `memberIds` es DERIVADO de `miembros` (T-182): se recalcula acá, después
    // de que `mergeByIdLevels` unió `miembros` por clave — nunca sale del
    // `memberIds` publicado por ninguno de los dos lados (ver `roster.ts`).
    const memberIds = rosterDe(g.miembros);
    if (mismoRoster(g.memberIds, memberIds)) return g;
    return { ...g, memberIds };
  });
}
