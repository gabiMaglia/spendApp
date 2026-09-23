import { deletionRound } from '@/src/algorithms/deletionRound';
import { attributedVote, type TrustState } from '@/src/algorithms/recordTrust';
import { useRecordTrust, useVoteTrust, voteRefKey } from '@/src/hooks/useRecordTrust';
import type { ActivityKind } from '@/src/store/selectors';

/** Insignia de confianza (firmado/pendiente) por evento del feed filtrado. */
export function useActivityTrust(filteredFeed: ActivityKind[], ahora: number) {
  const gastosDelFeed = filteredFeed.flatMap(ev =>
    ev.kind === 'expense_added' || ev.kind === 'expense_deleted' ? [ev.expense] : []);

  const pagosDelFeed = filteredFeed.flatMap(ev =>
    ev.kind === 'payment_made' ? [ev.payment] : []);

  const votosDelFeed = filteredFeed.flatMap(ev => {
    if (ev.kind !== 'expense_delete_request' && ev.kind !== 'expense_restored') return [];
    const vote = attributedVote(deletionRound(ev.expense, ahora), ev.expense.deletionVotes ?? []);
    return vote ? [{ expenseId: ev.expense.id, vote }] : [];
  });

  const marcaDeGasto = useRecordTrust('expense', gastosDelFeed);
  const marcaDePago  = useRecordTrust('payment', pagosDelFeed);
  const marcaDeVoto  = useVoteTrust(votosDelFeed);

  function marcaDeEvento(ev: ActivityKind): TrustState {
    if (ev.kind === 'payment_made') return marcaDePago[ev.payment.id] ?? 'pendiente';
    if (ev.kind === 'expense_added' || ev.kind === 'expense_deleted') {
      return marcaDeGasto[ev.expense.id] ?? 'pendiente';
    }
    // Un `PersonalEntry` es dato puramente local — no viaja firmado por el
    // relay (ADR-003), así que no hay nada que verificar: sin insignia.
    if (ev.kind === 'personal_entry') return 'pendiente';
    const vote = attributedVote(deletionRound(ev.expense, ahora), ev.expense.deletionVotes ?? []);
    return vote ? marcaDeVoto[voteRefKey(ev.expense.id, vote)] ?? 'pendiente' : 'pendiente';
  }

  return marcaDeEvento;
}
