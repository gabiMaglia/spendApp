import React from 'react';
import { useTranslation } from 'react-i18next';

import { formatMoney, type CurrencyCode } from '@/src/constants/currencies';
import { SplitStat } from '@/src/components/Band';
import { useColors } from '@/src/skins/useSkin';

/**
 * Te deben / Debés de ESTE grupo, sin compensar (T-225, PO 2026-09-29): con
 * 200 a favor y 60 en contra se ven los dos números, no un 140 que esconde
 * los 60. Mismo lenguaje y mismos colores que los casilleros de Grupos
 * (`GroupsSummaryStats`): Debés NO va en rojo, lo pidió el PO.
 */
export function TotalesDeGrupo({
  groupId, currency, owedToYou, youOwe,
}: {
  groupId: string;
  currency: CurrencyCode;
  owedToYou: number;
  youOwe: number;
}) {
  const { t } = useTranslation();
  const c = useColors();

  return (
    <SplitStat
      noTop
      items={[
        {
          label: t('groups.stat_owed_to_you'), value: formatMoney(owedToYou, currency),
          color: c.semantic.positive, id: `groupDetail.owedToYou:${groupId}`, minor: owedToYou, code: currency,
        },
        {
          label: t('groups.stat_you_owe'), value: formatMoney(youOwe, currency),
          color: c.textSecondary, id: `groupDetail.youOwe:${groupId}`, minor: youOwe, code: currency,
        },
      ]}
    />
  );
}
