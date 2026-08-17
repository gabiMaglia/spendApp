import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { hapticLight } from '@/src/utils/haptics';
import type { RecurrenceRule } from '@/src/types/models';

export type Frequency = RecurrenceRule['frequency'];

/** `null` = el gasto NO se repite. */
export type RecurrenceValue = Frequency | null;

const OPTIONS: Array<{ value: RecurrenceValue; key: string }> = [
  { value: null,          key: 'recurrence.once' },
  { value: 'weekly',      key: 'recurrence.weekly' },
  { value: 'fortnightly', key: 'recurrence.fortnightly' },
  { value: 'monthly',     key: 'recurrence.monthly' },
  { value: 'yearly',      key: 'recurrence.yearly' },
];

/**
 * Selector de repetición para el alta de un gasto.
 *
 * Se muestra siempre "Una vez" como opción explícita y por defecto: que el gasto
 * no se repita tiene que ser una elección visible, no la ausencia de una.
 */
export function RecurrencePicker({
  value,
  onChange,
}: {
  value: RecurrenceValue;
  onChange: (v: RecurrenceValue) => void;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={styles.wrap}>
      <Text style={[Typography.label, { color: c.textSecondary }]}>
        {t('recurrence.label')}
      </Text>

      <View style={styles.row}>
        {OPTIONS.map(opt => {
          const selected = opt.value === value;
          return (
            <Pressable
              key={String(opt.value)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => { hapticLight(); onChange(opt.value); }}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? c.brand.primary : c.surface,
                  borderColor:     selected ? c.brand.primary : c.borderHair,
                },
              ]}
            >
              <Text
                style={[
                  Typography.bodyS,
                  { color: selected ? c.textOnBrand : c.text, fontWeight: selected ? '600' : '400' },
                ]}
              >
                {t(opt.key)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {value !== null && (
        <Text style={[Typography.bodyS, { color: c.textTertiary }]}>
          {t('recurrence.hint')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing[2] },
  row:  { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2] },
  chip: {
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[3],
    borderRadius: Radius.full,
    borderWidth: 1,
  },
});
