import { reasonKey } from '@/src/algorithms/entryOrigin';
import { esDelMesCorriente } from '@/src/screens/personal/utils/mesCorriente';
import type { PersonalEntry } from '@/src/types/models';

/**
 * Por qué una entrada personal no se edita ni se borra, o `null` si se puede.
 *
 * Al origen (`reasonKey`, ADR-006) se suma el mes: una entrada de un mes
 * cerrado ya arrastró su saldo y tocarla lo dejaría desactualizado
 * (PO 2026-11-04, T-259).
 */
export function motivoDeBloqueo(
  entry: Pick<PersonalEntry, 'kind' | 'date'>,
  ahora: Date = new Date(),
): string | null {
  return reasonKey(entry) ?? (esDelMesCorriente(entry.date, ahora) ? null : 'personal.locked_closed_month');
}
