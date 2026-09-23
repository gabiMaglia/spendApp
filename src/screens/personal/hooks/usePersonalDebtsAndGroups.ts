import { useMemo } from 'react';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { esYo } from '@/src/store/identityAlias';
import { useDirectedDebts, useGlobalPersonBalances } from '@/src/store/selectors';
import { totalIOwe, totalOwedToMe } from '@/src/algorithms/directedDebts';
import type { CurrencyCode } from '@/src/constants/currencies';

/** "Te deben"/"Debés" (dirección de deuda, ADR-006) y la cantidad de grupos activos del usuario. */
export function usePersonalDebtsAndGroups(cur: CurrencyCode) {
  const { currentUser } = useAuthStore();
  useGlobalPersonBalances(currentUser?.id ?? '');
  const deudas = useDirectedDebts(currentUser?.id ?? '');
  const owedToMe = useMemo(() => totalOwedToMe(deudas, cur), [deudas, cur]);
  const youOwe   = useMemo(() => totalIOwe(deudas, cur), [deudas, cur]);

  const groups = useGroupStore(st => st.groups);
  const misGrupos = useMemo(
    () => groups.filter(g => !g.isDeleted && !!currentUser && g.memberIds.some(esYo)),
    [groups, currentUser],
  );

  return { currentUser, owedToMe, youOwe, misGrupos };
}
