import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ActionButton } from '@/src/components/ActionButton';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useColors } from '@/src/skins/useSkin';

/**
 * «Saldar todo» vs «de a uno» (ADR-006, decisión 2). T-223: salió de
 * `app/settle/new.tsx`.
 */
export function SelectorModoSaldo({
  cantidadAcreedores, deudaEnGrupo, currency, modoTodo, amount, onTodo, onUno,
}: {
  cantidadAcreedores: number;
  deudaEnGrupo: number;
  currency: CurrencyCode;
  modoTodo: boolean;
  amount: number;
  onTodo: () => void;
  onUno: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();

  return (
    <View style={{ gap: 8 }}>
      <ActionButton
        testID="settle-mode-all"
        label={t('settle.settle_all')}
        sub={t('settle.settle_all_sub', {
          count: cantidadAcreedores,
          amount: formatMoney(deudaEnGrupo, currency),
        })}
        icon="people-outline"
        variant={modoTodo ? 'primary' : 'ghost'}
        full
        action={onTodo}
      />
      <ActionButton
        testID="settle-mode-one"
        label={t('settle.settle_one')}
        icon="person-outline"
        variant={modoTodo ? 'ghost' : 'primary'}
        full
        action={onUno}
      />
      {modoTodo && amount > 0 && amount < deudaEnGrupo && (
        <Text style={[Typography.bodyS, { color: c.semantic.warning }]}>
          {t('settle.split_note')}
        </Text>
      )}
    </View>
  );
}
