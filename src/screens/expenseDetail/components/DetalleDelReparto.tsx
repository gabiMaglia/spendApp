import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import { UserAvatar } from '@/src/components/UserAvatar';
import { esYo } from '@/src/store/identityAlias';
import type { Expense, Split } from '@/src/types/models';
import { useColors } from '@/src/skins/useSkin';
import { SeccionDeGasto } from '@/src/screens/expenseDetail/components/SeccionDeGasto';

/**
 * Una fila por persona con su parte, marcando quién pagó.
 * T-223: salió de `app/expense/[id].tsx`.
 */
export function DetalleDelReparto({ expense, splits, getUserName }: {
  expense: Expense;
  splits: Split[];
  getUserName: (uid: string) => string;
}) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <SeccionDeGasto titulo={t('expense.split_detail')}>
      {splits.map((split, i) => {
        const name = esYo(split.userId)
          ? t('common.you')
          : getUserName(split.userId);
        const isThisPayer = expense.paidById === split.userId;
        return (
          <View
            key={split.userId}
            style={[
              styles.splitRow,
              i < splits.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.hair2 },
            ]}
          >
            <UserAvatar userId={split.userId} name={name} size={36} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]}>
                {name}
                {isThisPayer && (
                  <Text style={{ color: c.textTertiary, fontWeight: '400' }}>
                    {' '}· {t('expense.paid_label')}
                  </Text>
                )}
              </Text>
            </View>
            <Text style={[Typography.amountS, { color: c.text }]}>
              {formatMoney(split.amount, expense.currency)}
            </Text>
          </View>
        );
      })}
    </SeccionDeGasto>
  );
}

const styles = StyleSheet.create({
  splitRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
});
