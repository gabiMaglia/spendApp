import React from 'react';
import { Linking, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { LEGAL_DISPONIBLE, urlDePrivacidad, urlDeTerminos } from '@/src/constants/legal';
import { Typography } from '@/src/constants/typography';
import { useColors } from '@/src/skins/useSkin';

/**
 * Los dos links ABREN. Hasta T-090 eran texto pintado del color de
 * marca sin `onPress`: parecían links y no llevaban a ningún lado.
 * Mientras `LEGAL_DISPONIBLE` esté apagado siguen siendo texto, que
 * es lo honesto — la puerta se ofrece cuando existe.
 * T-223: salió de `app/auth/index.tsx`.
 */
export function LinksLegales() {
  const { t } = useTranslation();
  const c = useColors();

  return (
    <Text style={[Typography.bodyS, { color: c.textTertiary, textAlign: 'center' }]}>
      {t('auth.terms_prefix')}{' '}
      <Text
        style={{ color: c.brand.primary, fontWeight: '600' }}
        onPress={LEGAL_DISPONIBLE ? () => void Linking.openURL(urlDeTerminos()) : undefined}
      >
        {t('auth.terms_link')}
      </Text>
      {' '}{t('auth.privacy_and')}{' '}
      <Text
        style={{ color: c.brand.primary, fontWeight: '600' }}
        onPress={LEGAL_DISPONIBLE ? () => void Linking.openURL(urlDePrivacidad()) : undefined}
      >
        {t('auth.privacy_link')}
      </Text>
      {'. '}{t('auth.terms_suffix')}
    </Text>
  );
}
