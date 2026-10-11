import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useSkin } from '@/src/skins/useSkin';

/**
 * «Con vos y: [grupo]» — primera fila del alta estilo Splitwise (feat/reskin,
 * variante B4). Abre la hoja de grupo; en edición el grupo no se cambia.
 */
export function ConQuien({
  groupName, onPress, disabled,
}: { groupName: string; onPress: () => void; disabled: boolean }) {
  const { t } = useTranslation();
  const { skin } = useSkin();
  const c = skin.colors;
  return (
    <View style={styles.fila}>
      <Text style={[Typography.bodyM, { color: c.textSecondary }]}>{t('expense.with_you_and')}</Text>
      <Pressable
        testID="con-quien"
        onPress={disabled ? undefined : onPress}
        accessibilityRole="button"
        style={[styles.chip, { backgroundColor: c.surface, boxShadow: skin.elevation.e1.boxShadow }]}
      >
        <View style={[styles.icono, { backgroundColor: c.brand.primarySoft }]}>
          <Ionicons name="people-outline" size={15} color={c.brand.primary} />
        </View>
        <Text numberOfLines={1} style={[Typography.bodyL, styles.nombre, { color: c.text }]}>{groupName}</Text>
        {!disabled && <Ionicons name="chevron-down" size={13} color={c.textTertiary} />}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fila: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: Spacing.screenPad + 8,
  },
  chip: {
    flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    height: 36, paddingLeft: 4, paddingRight: 12, borderRadius: 999,
  },
  icono: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  nombre: { flexShrink: 1 },
});
