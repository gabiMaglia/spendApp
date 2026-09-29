import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppLogoMark } from '@/src/components/AppLogoMark';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColors } from '@/src/skins/useSkin';

/** Logo + bienvenida del login. T-223: salió de `app/auth/index.tsx`. */
export function HeroDeLogin() {
  const { t } = useTranslation();
  const c = useColors();

  return (
    <View style={styles.hero}>
      <AppLogoMark size={84} />
      <View style={styles.heroText}>
        <Text style={[Typography.display, { color: c.text, textAlign: 'center', lineHeight: 40 }]}>
          {t('auth.welcome_title')}
        </Text>
        <Text style={[Typography.bodyL, { color: c.textSecondary, textAlign: 'center', maxWidth: 280 }]}>
          {t('auth.welcome_subtitle')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero:     { alignItems: 'center', gap: 24, marginBottom: Spacing[8] },
  heroText: { alignItems: 'center', gap: 8 },
});
