import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { Band, BandRow } from '@/src/components/Band';
import { useColors } from '@/src/skins/useSkin';

/**
 * Traspaso manual — siempre disponible, no sólo cuando se llega al aviso
 * (T-058). Quien lo monta decide si el grupo lo admite (no archivado).
 * T-223: salió de `app/groups/[id].tsx`.
 */
export function TraspasoManual({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const c = useColors();

  return (
    <>
      <Band>
        <BandRow testID="traspaso-manual-btn" onPress={onPress} last>
          <Text style={[Typography.bodyL, { color: c.brand.primary, flex: 1, textAlign: 'center' }]}>
            {t('groups.traspaso_manual_action')}
          </Text>
        </BandRow>
      </Band>
      <Text style={[Typography.caption, styles.traspasoHint, { color: c.textTertiary }]}>
        {t('groups.traspaso_carry_over_hint')}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  traspasoHint: {
    textAlign: 'center', paddingHorizontal: Spacing.screenPad, marginTop: Spacing[2],
  },
});
