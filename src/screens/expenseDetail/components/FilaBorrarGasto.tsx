import React from 'react';
import { Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { Band, BandRow } from '@/src/components/Band';
import { useColors } from '@/src/skins/useSkin';

/**
 * Borrar. Va como fila de banda (T-107): borde a borde, sin relleno ni radio,
 * igual que las filas de Yo. El rojo queda sólo en el ícono y el texto.
 * T-223: salió de `app/expense/[id].tsx`.
 */
export function FilaBorrarGasto({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <Band style={{ marginBottom: Spacing[4] }}>
      <BandRow onPress={onPress} last accessibilityRole="button">
        <Ionicons name="trash-outline" size={19} color={c.semantic.negative} />
        <Text style={[Typography.bodyL, { flex: 1, color: c.semantic.negative, fontWeight: '600' }]}>
          {t('expense.delete_expense')}
        </Text>
      </BandRow>
    </Band>
  );
}
