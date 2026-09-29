import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { FondoMarmol } from '@/src/components/FondoMarmol';
import { MoneyText } from '@/src/components/MoneyText';
import { CategoryIcon } from '@/src/components/CategoryIcon';
import { TrustMark } from '@/src/components/TrustMark';
import { isMarked, type TrustState } from '@/src/algorithms/recordTrust';
import type { CategoryKind } from '@/src/constants/colors';
import type { Expense } from '@/src/types/models';
import { useColors } from '@/src/skins/useSkin';

/**
 * Tarjeta héroe del Detalle de gasto: categoría, descripción, monto y fecha.
 * T-223: salió de `app/expense/[id].tsx`.
 */
export function HeroDelGasto({ expense, dateStr, marca, nombreDe }: {
  expense: Expense;
  dateStr: string;
  marca: TrustState | undefined;
  nombreDe: (uid: string) => string;
}) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={[styles.hero, { borderColor: c.hair, backgroundColor: c.surface }]}>
      <FondoMarmol patron="distendida" style={styles.heroMarmol} />
      <CategoryIcon kind={expense.category as CategoryKind} size={64} />
      <Text style={[Typography.h1, { color: c.text, textAlign: 'center', marginTop: 12 }]}>
        {expense.description}
      </Text>
      <MoneyText minor={expense.amount} code={expense.currency} style={[Typography.amountL, { color: c.text, marginTop: 4 }]} />
      <Text style={[Typography.bodyS, { color: c.textTertiary, marginTop: 4 }]}>
        {dateStr}
      </Text>
      {/* T-185: rastro de quién editó, sólo si NO fue el autor — un grupo
          `open` deja que cualquiera edite, y esto es lo que lo hace visible
          (Splitwise lo llama "editado por"). */}
      {expense.editedById && expense.editedById !== expense.createdById && (
        <Text style={[Typography.bodyS, { color: c.textTertiary, marginTop: 2 }]}>
          {t('expense.edited_by', { name: nombreDe(expense.editedById) })}
        </Text>
      )}
      {/* Marcado, pero se muestra entero y suma al balance igual: es la
          invariante de R1. La marca informa, no esconde ni bloquea. */}
      {isMarked(marca ?? 'pendiente') && (
        <View style={{ marginTop: Spacing[2] }}>
          <TrustMark label={t('trust.expense')} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center', overflow: 'hidden',
    marginHorizontal: Spacing.screenPad, marginBottom: Spacing[5],
    paddingHorizontal: Spacing.screenPad, paddingVertical: Spacing[6],
    borderRadius: Radius['2xl'], borderCurve: 'continuous', borderWidth: 1,
  },
  heroMarmol: { top: 0, bottom: 0 },
});
