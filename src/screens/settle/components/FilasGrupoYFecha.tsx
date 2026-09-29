import React from 'react';
import { Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Band, BandRow } from '@/src/components/Band';
import { Typography } from '@/src/constants/typography';
import { useColors } from '@/src/skins/useSkin';
import { formatDate } from '@/src/screens/settle/saldoDeGrupo';
import { estilos } from '@/src/screens/settle/components/estilos';

/**
 * Grupo y fecha: filas de banda, no chips sueltos. T-223: salió de
 * `app/settle/new.tsx`.
 */
export function FilasGrupoYFecha({
  nombreGrupo, date, onPressGrupo, onPressFecha,
}: {
  nombreGrupo: string | undefined;
  date: Date;
  onPressGrupo: () => void;
  onPressFecha: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();

  return (
    <Band style={estilos.card}>
      <BandRow onPress={onPressGrupo}>
        <Ionicons name="people-outline" size={17} color={c.textSecondary} />
        <Text style={[Typography.bodyM, { color: c.textSecondary, flex: 1 }]}>
          {t('expense.group_label')}
        </Text>
        <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]} numberOfLines={1}>
          {nombreGrupo ?? t('expense.no_group_short')}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={c.textTertiary} />
      </BandRow>
      <BandRow last onPress={onPressFecha}>
        <Ionicons name="calendar-outline" size={17} color={c.textSecondary} />
        <Text style={[Typography.bodyM, { color: c.textSecondary, flex: 1 }]}>
          {t('settle.date_label')}
        </Text>
        <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]}>
          {formatDate(date)}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={c.textTertiary} />
      </BandRow>
    </Band>
  );
}
