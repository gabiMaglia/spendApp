import { toMonthKey } from '@/src/store/personalStore';
import type { PersonalEntry } from '@/src/types/models';

/** Movimientos vivos de un mes (`YYYY-MM`), sin ordenar. Los comparten Personal y «Ver todos». */
export function movimientosDelMes(entries: PersonalEntry[], month: string): PersonalEntry[] {
  return entries.filter(e => !e.isDeleted && toMonthKey(e.date) === month);
}
