import { useGroupsTotalBalance } from '@/src/store/selectors';
import { useFx } from '@/src/store/useFx';
import { sumConverted } from '@/src/services/fxTotals';

/** "Te deben"/"Debés" globales — todos los grupos activos del usuario, sin importar la pestaña. */
export function useGroupsBalances(currentUserId: string) {
  const groupTotals = useGroupsTotalBalance(currentUserId);
  const { fx, display: cur } = useFx();

  const deben = sumConverted(
    groupTotals.map(g => ({ currency: g.currency, minor: g.owedToYou })), cur, fx,
  );
  const debo = sumConverted(
    groupTotals.map(g => ({ currency: g.currency, minor: g.youOwe })), cur, fx,
  );

  return { cur, fx, owedToYou: deben.totalMinor, youOwe: debo.totalMinor };
}
