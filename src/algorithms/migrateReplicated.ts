import type { PersonalEntry } from '@/src/types/models';

/**
 * Migración v2 de réplicas (T-229). Desde T-229 lo que puse en un gasto de
 * grupo se DERIVA en lectura (`movimientosDerivados`); las réplicas que se
 * guardaron antes (id uuid) quedan de más. Se tombstonean — nunca DELETE —
 * las vivas que no son congelados (`rep_…`).
 */
export function planTombstoneReplicas(entries: readonly PersonalEntry[]): string[] {
  return entries
    .filter(e => e.kind === 'group_replicated' && !e.isDeleted && !e.id.startsWith('rep_'))
    .map(e => e.id);
}
