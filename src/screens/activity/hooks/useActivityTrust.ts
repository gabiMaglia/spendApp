import type { TrustState } from '@/src/algorithms/recordTrust';
import { useRecordTrust } from '@/src/hooks/useRecordTrust';
import type { ActivityKind } from '@/src/store/selectors';

/**
 * Insignia de confianza (firmado/pendiente) por evento del feed filtrado.
 *
 * Sólo los núcleos firmados (gasto, pago) tienen algo que verificar. Un
 * `expense_restored` (T-186, opción B) es una etiqueta LWW sin firma —
 * `deletedById`/`restoredById`— así que no hay nada que marcar ahí: queda
 * `pendiente`, ni acusa ni avala.
 */
export function useActivityTrust(filteredFeed: ActivityKind[]) {
  const gastosDelFeed = filteredFeed.flatMap(ev =>
    ev.kind === 'expense_added' || ev.kind === 'expense_deleted' ? [ev.expense] : []);

  const pagosDelFeed = filteredFeed.flatMap(ev =>
    ev.kind === 'payment_made' ? [ev.payment] : []);

  const marcaDeGasto = useRecordTrust('expense', gastosDelFeed);
  const marcaDePago  = useRecordTrust('payment', pagosDelFeed);

  function marcaDeEvento(ev: ActivityKind): TrustState {
    if (ev.kind === 'payment_made') return marcaDePago[ev.payment.id] ?? 'pendiente';
    if (ev.kind === 'expense_added' || ev.kind === 'expense_deleted') {
      return marcaDeGasto[ev.expense.id] ?? 'pendiente';
    }
    // `personal_entry` (dato local, ADR-003) y `expense_restored` (etiqueta
    // sin firma): ninguno de los dos tiene nada que verificar.
    return 'pendiente';
  }

  return marcaDeEvento;
}
