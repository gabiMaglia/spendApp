import React from 'react';
import { useTranslation } from 'react-i18next';

import type { CurrencyCode } from '@/src/constants/currencies';
import { FilaDeTotal } from '@/src/components/FilaDeTotal';

/**
 * Balance neto del grupo (te deben − debés), al pie del historial y con el
 * mismo estilo que el Total de Grupos (T-225, PO 2026-09-29). Arriba quedan
 * los dos números sin compensar (`TotalesDeGrupo`).
 */
const SANGRIA_FILA_DE_TIMELINE = 36 + 13;

export function BalanceDeGrupo({
  groupId, currency, neto,
}: {
  groupId: string;
  currency: CurrencyCode;
  neto: number;
}) {
  const { t } = useTranslation();
  return (
    <FilaDeTotal
      testID="group-net-balance"
      label={t('group_detail.balance_label')}
      minor={neto}
      code={currency}
      montoId={`groupDetail.balance:${groupId}`}
      sangria={SANGRIA_FILA_DE_TIMELINE}
    />
  );
}
