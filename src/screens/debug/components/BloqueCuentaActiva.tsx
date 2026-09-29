import React from 'react';

import { useLiveValue } from '@/src/hooks/useLiveValue';
import { misIdentidades } from '@/src/store/identityAlias';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { Block, Row } from '@/src/screens/debug/components/Filas';

/** «CUENTA ACTIVA» del Diagnóstico. T-223: salió de `app/debug/identity.tsx`. */
export function BloqueCuentaActiva({ accountId, c }: { accountId: string | null; c: any }) {
  const identidades = useLiveValue(() => misIdentidades());
  const groups = useGroupStore(st => st.groups);
  const expenses = useExpenseStore(st => st.expenses);

  return (
    <Block title="CUENTA ACTIVA" c={c}>
      <Row label="accountId" value={accountId ?? '(sin sesión)'} c={c} />
      {/* Las identidades viejas (T-048). Sin esta fila, "mis grupos
          desaparecieron" y "el alias no se sembró" se ven exactamente
          igual desde afuera. */}
      <Row label="identidades viejas"
           value={identidades.length > 1 ? identidades.slice(1).join(', ') : '(ninguna)'} c={c} />
      <Row label="grupos visibles" value={String(groups.length)} c={c} />
      <Row label="gastos visibles" value={String(expenses.length)} c={c} />
    </Block>
  );
}
