import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Radius } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { Band, BandRow, SectionLabel } from '@/src/components/Band';
import { useColors } from '@/src/skins/useSkin';

/** Plan — la pantalla sólo lo monta con `PRO_DISPONIBLE` (ver tierStore).
 *  Fragmento: etiqueta y banda son hijos directos del scroll. */
export function SeccionPlan({ isPro }: { isPro: boolean }) {
  const c = useColors();
  const { t } = useTranslation();
  return (
    <>
      <SectionLabel label={t('profile.section_plan')} />
      <Band>
        <BandRow last>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[Typography.bodyL, { color: c.text }]}>
              {isPro ? t('profile.plan_pro') : t('profile.plan_free')}
            </Text>
            {!isPro && (
              <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('profile.free_daily')}</Text>
            )}
          </View>
          {isPro ? (
            <View style={[styles.pill, { backgroundColor: c.brand.primary }]}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#fff' }}>PRO</Text>
            </View>
          ) : (
            <Pressable style={[styles.pill, { backgroundColor: c.brand.primary }]}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>{t('profile.try_pro')}</Text>
            </Pressable>
          )}
        </BandRow>
      </Band>
    </>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full },
});
