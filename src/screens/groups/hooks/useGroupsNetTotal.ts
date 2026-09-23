import { useMemo } from 'react';
import { useGroupsNetBalanceFor } from '@/src/store/selectors';
import { sumConverted } from '@/src/services/fxTotals';
import type { CurrencyCode } from '@/src/constants/currencies';
import type { FxCache } from '@/src/services/fx';

/**
 * "Total" al pie de la lista (PO 2026-09-22): a diferencia de los cuatro
 * casilleros de arriba —que describen "tu situación" y no se mueven con la
 * pestaña—, esto SÍ cambia: es la cuenta separada de lo que se ve ahora
 * mismo, activos o archivados según la pestaña.
 */
export function useGroupsNetTotal(
  currentUserId: string,
  visibleGroupIds: string[],
  cur: CurrencyCode,
  fx: FxCache | null,
): number {
  const idsVisibles = useMemo(() => new Set(visibleGroupIds), [visibleGroupIds]);
  const netVisibles = useGroupsNetBalanceFor(currentUserId, idsVisibles);
  return sumConverted(
    netVisibles.map(b => ({ currency: b.currency, minor: b.net })), cur, fx,
  ).totalMinor;
}
