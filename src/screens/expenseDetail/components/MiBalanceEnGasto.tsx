import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Typography } from '@/src/constants/typography';
import { formatMoney, type CurrencyCode } from '@/src/constants/currencies';
import { useColors } from '@/src/skins/useSkin';
import { SeccionDeGasto } from '@/src/screens/expenseDetail/components/SeccionDeGasto';

/**
 * Mi balance en este gasto: quién pagó, mi parte y el neto.
 * T-223: salió de `app/expense/[id].tsx`.
 */
export function MiBalanceEnGasto({ pagador, myShare, netForMe, currency }: {
  pagador: string;
  myShare: number;
  netForMe: number;
  currency: CurrencyCode;
}) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <SeccionDeGasto titulo={t('expense.your_balance')}>
      <View style={styles.balanceRow}>
        <View style={styles.balanceCol}>
          <Text style={[Typography.caption, { color: c.textTertiary }]}>
            {t('expense.paid_by')}
          </Text>
          <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600', marginTop: 2 }]}>
            {pagador}
          </Text>
        </View>
        <View style={[styles.balanceDivider, { backgroundColor: c.hair }]} />
        <View style={styles.balanceCol}>
          <Text style={[Typography.caption, { color: c.textTertiary }]}>
            {t('expense.your_share')}
          </Text>
          <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600', marginTop: 2 }]}>
            {formatMoney(myShare, currency)}
          </Text>
        </View>
        <View style={[styles.balanceDivider, { backgroundColor: c.hair }]} />
        <View style={styles.balanceCol}>
          <Text style={[Typography.caption, { color: c.textTertiary }]}>
            {t('expense.net')}
          </Text>
          <Text style={[Typography.amountS, {
            color: netForMe >= 0 ? c.semantic.positive : c.semantic.negative,
            marginTop: 2,
          }]}>
            {netForMe >= 0 ? '+' : ''}{formatMoney(netForMe, currency)}
          </Text>
        </View>
      </View>
    </SeccionDeGasto>
  );
}

const styles = StyleSheet.create({
  balanceRow:    { flexDirection: 'row', alignItems: 'center' },
  balanceCol:    { flex: 1, alignItems: 'center' },
  balanceDivider:{ width: 1, height: 32 },
});
