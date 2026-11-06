import React from 'react';

import type { CurrencyCode } from '@/src/constants/currencies';
import { SaldoNeto } from '@/src/components/SaldoNeto';

/**
 * Saldo de ESTE grupo (PO 2026-11-06, opción A): el neto grande y, debajo,
 * Te deben / Debés sin compensar (T-225). En un grupo de dos, la etiqueta
 * nombra a la otra persona («Marina te debe»). Reemplaza a `BalanceDeGrupo`,
 * el neto que vivía al pie del historial.
 */
export function TotalesDeGrupo({
  groupId, currency, owedToYou, youOwe, contraparte,
}: {
  groupId: string;
  currency: CurrencyCode;
  owedToYou: number;
  youOwe: number;
  contraparte?: string;
}) {
  return (
    <SaldoNeto
      noTop
      owedToYou={owedToYou}
      youOwe={youOwe}
      code={currency}
      contraparte={contraparte}
      ids={{
        neto: `groupDetail.balance:${groupId}`,
        owedToYou: `groupDetail.owedToYou:${groupId}`,
        youOwe: `groupDetail.youOwe:${groupId}`,
      }}
    />
  );
}
