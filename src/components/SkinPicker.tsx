import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BandRow, Segmented, useC } from '@/src/components/Band';
import { Typography } from '@/src/constants/typography';
import { useSettingsStore } from '@/src/store/settingsStore';
import type { SkinId } from '@/src/skins/registry';

/**
 * Fila "Estilo" de Yo (PO 2026-09-25): elige el skin. Aero está en vista
 * previa —por ahora solo cambia Personal— y la nota lo dice.
 */
export function SkinPicker({ last = true }: { last?: boolean }) {
  const { t } = useTranslation();
  const c = useC();
  const skin = useSettingsStore(s => s.skin);
  const setSkin = useSettingsStore(s => s.setSkin);

  return (
    <BandRow last={last}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[Typography.bodyL, { color: c.text }]}>{t('profile.skins')}</Text>
        <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('profile.skin_preview_note')}</Text>
      </View>
      <Segmented<SkinId>
        compact
        value={skin}
        onChange={setSkin}
        options={[
          { key: 'default', label: t('profile.skin_classic') },
          { key: 'aero', label: t('profile.skin_aero') },
        ]}
      />
    </BandRow>
  );
}
