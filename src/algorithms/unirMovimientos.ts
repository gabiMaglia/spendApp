import type { PersonalEntry } from '@/src/types/models';

/** Una réplica guardada antes de T-229 (id uuid, no `rep_…`): se ignora en lectura. */
function esReplicaVieja(e: PersonalEntry): boolean {
  return e.kind === 'group_replicated' && !e.id.startsWith('rep_');
}

/**
 * Guardados vivos (manuales, carryover, congelados) + derivados, sin repetir id
 * (T-229). Si un congelado y un derivado comparten id, gana el derivado: su
 * fuente sigue en el teléfono y es la verdad.
 */
export function unirMovimientos(
  guardados: readonly PersonalEntry[], derivados: readonly PersonalEntry[],
): PersonalEntry[] {
  const ids = new Set(derivados.map(d => d.id));
  return [
    ...guardados.filter(e => !e.isDeleted && !esReplicaVieja(e) && !ids.has(e.id)),
    ...derivados,
  ];
}
