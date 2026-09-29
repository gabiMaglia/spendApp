import { useDirectedDebts, useGlobalPersonBalances } from '@/src/store/selectors';
import { useFx } from '@/src/store/useFx';
import { sumConverted } from '@/src/services/fxTotals';

/**
 * "Te deben"/"Debés" globales de Amigos, con el mismo criterio de "pending" que
 * Personal (T-109).
 *
 * T-225 (PO 2026-09-29): los casilleros son la suma de lo que me debe cada
 * amigo y la suma de lo que le debo a cada uno, SIN compensar (deuda
 * direccional). La tarjeta de cada amigo sí muestra su neto (`personBalances`).
 */
export function useFriendsBalances(currentUserId: string) {
  const personBalances = useGlobalPersonBalances(currentUserId);
  const deudas = useDirectedDebts(currentUserId);
  const { fx, display: cur, loading: fxLoading } = useFx();

  const deben = sumConverted(
    deudas.filter(d => d.owesMe > 0).map(d => ({ currency: d.currency, minor: d.owesMe })), cur, fx,
  );
  const debo = sumConverted(
    deudas.filter(d => d.iOwe > 0).map(d => ({ currency: d.currency, minor: d.iOwe })), cur, fx,
  );

  return {
    cur, personBalances,
    owedToYou: deben.totalMinor,
    youOwe: debo.totalMinor,
    owedToYouPending: deben.pending && fxLoading,
    youOwePending: debo.pending && fxLoading,
  };
}
