import React from 'react';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { formatMoney, type CurrencyCode } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { StatGrid } from '@/src/components/Band';

/** Los 4 casilleros de arriba (2×2): describen "tu situación", no la lista de abajo — no dependen de la pestaña. */
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
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <StatGrid
      noTop
      items={[
        { label: t('groups.stat_groups'),  value: String(activeGroupCount), id: 'groups.count', minor: activeGroupCount },
        { label: t('groups.stat_expenses'), value: String(expenseCount), id: 'groups.expenseCount', minor: expenseCount },
        { label: t('groups.stat_owed_to_you'), value: formatMoney(owedToYou, cur), color: c.semantic.positive, id: 'groups.owedToYou', minor: owedToYou, code: cur },
        { label: t('groups.stat_you_owe'),     value: formatMoney(youOwe, cur),    color: c.textSecondary,     id: 'groups.youOwe',   minor: youOwe,    code: cur },
      ]}
    />
  );
}
