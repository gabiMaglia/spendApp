import { mergeByIdLevels } from './mergeLevels';
import { mergeDeletionMode } from '@/src/algorithms/deletionPolicy';
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
 * Merge puro de grupos: por niveles, más la regla del modo de borrado.
 *
 * Vive en su propio módulo (T-149 · D2 verifier) y no adentro de
 * `groupStore.ts` a propósito: ese store importa `relayEngine` (para
 * `schedulePublish`), que arrastra el relay, `authorHealth` y `deviceKeys`.
 * `accountLink.mergeAccounts` necesita esta función para fusionar cuentas SIN
 * arrastrar esa cadena — sólo `mergeByIdLevels` y `mergeDeletionMode`, que son
 * puros. `groupStore.mergeGroups` importa esta MISMA función; no hay una
 * segunda copia en ningún lado.
 *
 * `deletionMode` NO se sincroniza ni se fusiona por LWW: lo fija quien crea el
 * grupo. Sin `mergeDeletionMode`, `mergeByIdLevels` desnudo lo decidiría por
 * `updatedAt` y una fusión podría bajar un grupo de `consensus` a `open`
 * (reabre T-053) si la cuenta absorbida traía el modo más flojo con
 * `updatedAt` mayor.
 */
export function mergeGroupsPure(current: Group[], incoming: Group[], now: number): Group[] {
  const antes = new Map(current.map(g => [g.id, g]));
  return mergeByIdLevels('group', current, incoming, now).map(g => {
    const local = antes.get(g.id);
    const remoto = incoming.find(x => x.id === g.id);
    const modo = mergeDeletionMode(antes.has(g.id), local?.deletionMode, remoto?.deletionMode);

    // `memberIds` es DERIVADO de `miembros` (T-182): se recalcula acá, después
    // de que `mergeByIdLevels` unió `miembros` por clave — nunca sale del
    // `memberIds` publicado por ninguno de los dos lados (ver `roster.ts`).
    const memberIds = rosterDe(g.miembros);

    const cambioModo    = g.deletionMode !== modo;
    const cambioRoster  = !mismoRoster(g.memberIds, memberIds);
    if (!cambioModo && !cambioRoster) return g;

    const salida = { ...g };
    if (cambioModo)   salida.deletionMode = modo;
    if (cambioRoster) salida.memberIds = memberIds;
    return salida;
  });
}
