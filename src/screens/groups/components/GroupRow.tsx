import React from 'react';
import { useGroupBalance, useGroupExpenseCount } from '@/src/store/selectors';
import { GroupCard } from '@/src/components/GroupCard';
import type { Group } from '@/src/types/models';

/**
 * Memoizada (PO 2026-09-22, rendimiento en gama baja): esta fila llama
 * `useGroupBalance`, que corre `calculateBalancesByCurrency` — no es gratis.
 * El memo sólo ahorra algo real si `onPress` es una referencia ESTABLE (ver
 * `handleOpenGroup` en `useGroupsList`, `useCallback` sin depender del array
 * de grupos) — con un `() => …` inline en el `.map()`, el memo no servía de
 * nada porque esa prop "cambiaba" en cada render igual.
 */
export const GroupRow = React.memo(function GroupRow({
  group, currentUserId, onPress, last,
}: { group: Group; currentUserId: string; onPress: (id: string) => void; last?: boolean }) {
  const balances     = useGroupBalance(group.id, currentUserId);
  const expenseCount = useGroupExpenseCount(group.id);
  const mainBalance  = balances.find(b => b.currency === group.currency)?.amount ?? 0;

  return (
    <GroupCard
      name={group.name}
      memberIds={group.memberIds}
      balance={mainBalance}
      currency={group.currency}
      subtitle={`${expenseCount} gastos`}
      onPress={() => onPress(group.id)}
      last={last}
      chevron
    />
  );
});
