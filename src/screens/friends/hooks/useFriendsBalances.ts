import { useGlobalPersonBalances } from '@/src/store/selectors';
import { useFx } from '@/src/store/useFx';
import { sumConverted } from '@/src/services/fxTotals';

/** "Te deben"/"Debés" globales de Amigos, con el mismo criterio de "pending" que Personal (T-109). */
export function useFriendsBalances(currentUserId: string) {
  const personBalances = useGlobalPersonBalances(currentUserId);
  const { fx, display: cur, loading: fxLoading } = useFx();

  const deben = sumConverted(
    personBalances.filter(p => p.amount > 0).map(p => ({ currency: p.currency, minor: p.amount })),
    cur, fx,
  );
  const debo = sumConverted(
    personBalances.filter(p => p.amount < 0).map(p => ({ currency: p.currency, minor: -p.amount })),
    cur, fx,
  );

  return {
    cur, personBalances,
    owedToYou: deben.totalMinor,
    youOwe: debo.totalMinor,
    owedToYouPending: deben.pending && fxLoading,
    youOwePending: debo.pending && fxLoading,
  };
}
