import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import type { CurrencyCode } from '@/src/constants/currencies';
import { MontoRodante } from '@/src/components/MontoRodante';
import { Band } from '@/src/components/Band';
import { useColors } from '@/src/skins/useSkin';

/**
 * Balance: banda, no tarjeta. La cifra es lo primero que se lee.
 * T-223: salió de `app/groups/[id].tsx`.
 */
export function BalanceDeGrupo({
  groupId, currency, mainBalance,
}: {
  groupId: string;
  currency: CurrencyCode;
  mainBalance: number;
}) {
  const { t } = useTranslation();
  const c = useColors();

  const balanceColor = mainBalance > 0 ? c.semantic.positive
    : mainBalance < 0 ? c.semantic.negative
    : c.textSecondary;

  return (
    <Band>
      <View style={styles.balancePad}>
        <Text style={[Typography.label, styles.upper, { color: c.textTertiary }]}>
          {t('group_detail.balance_label')}
        </Text>
        <MontoRodante
          id={`groupDetail.balance:${groupId}`}
          minor={mainBalance}
          code={currency}
          prefix={mainBalance > 0 ? '+' : ''}
          style={[Typography.amountXL, { color: balanceColor, marginTop: 2 }]}
        />
        <Text style={[Typography.caption, { color: c.textTertiary, marginTop: 4 }]}>
          {mainBalance > 0 ? t('group_detail.owe_you')
            : mainBalance < 0 ? t('group_detail.you_owe_short')
            : t('group_detail.settled_up')}
        </Text>
      </View>
    </Band>
  );
}

const styles = StyleSheet.create({
  upper:      { textTransform: 'uppercase' },
  balancePad: { paddingHorizontal: Spacing.screenPad, paddingTop: 18, paddingBottom: 18 },
});
