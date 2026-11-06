import React from 'react';
import { useTranslation } from 'react-i18next';

import type { CurrencyCode } from '@/src/constants/currencies';
import { SplitStat } from '@/src/components/Band';
import { SaldoNeto } from '@/src/components/SaldoNeto';

/**
 * Lo de arriba de Grupos: describe "tu situación", no la lista de abajo — no
 * depende de la pestaña. Conteos en una fila y, debajo, el saldo neto con su
 * desglose sin compensar (PO 2026-11-06, opción A; antes era una grilla 2×2
 * con Te deben / Debés como dos números iguales).
 */
export function GroupsSummaryStats({
  activeGroupCount, expenseCount, owedToYou, youOwe, cur,
}: {
  activeGroupCount: number;
  expenseCount: number;
  owedToYou: number;
  youOwe: number;
  cur: CurrencyCode;
}) {
  const { t } = useTranslation();

  return (
    <>
      <SplitStat
        noTop
        items={[
          { label: t('groups.stat_groups'),  value: String(activeGroupCount), id: 'groups.count', minor: activeGroupCount },
          { label: t('groups.stat_expenses'), value: String(expenseCount), id: 'groups.expenseCount', minor: expenseCount },
        ]}
      />
      <SaldoNeto
        noTop
        owedToYou={owedToYou}
        youOwe={youOwe}
        code={cur}
        ids={{ neto: 'groups.neto', owedToYou: 'groups.owedToYou', youOwe: 'groups.youOwe' }}
      />
    </>
  );
}
