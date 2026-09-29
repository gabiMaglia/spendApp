import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { APP_VERSION } from '@/src/constants/version';
import { Band, BandRow, SectionLabel, SoonBadge } from '@/src/components/Band';
import { useColors } from '@/src/skins/useSkin';
import { LinkRow } from '@/src/screens/cuenta/components/FilasDeCuenta';

/** Seguridad, cerrar sesión, borrar cuenta, atajos de DEV y la versión.
 *  Fragmento: hijos directos del scroll. */
export function PieDeCuenta({ signOut }: { signOut: () => void }) {
  const c = useColors();
  const { t } = useTranslation();

  function handleSignOut() {
    Alert.alert(
      t('profile.sign_out'),
      t('profile.sign_out_confirm_body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('profile.sign_out'), style: 'destructive', onPress: signOut },
      ],
    );
  }

  return (
    <>
      {/* Seguridad */}
      <SectionLabel label={t('profile.section_security')} />
      <Band>
        <BandRow last>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[Typography.bodyL, { color: c.text }]}>{t('profile.biometric')}</Text>
            <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('profile.biometric_sub')}</Text>
          </View>
          <SoonBadge />
        </BandRow>
      </Band>

      <View style={{ paddingHorizontal: Spacing.screenPad, paddingTop: 26 }}>
        <Pressable
          onPress={handleSignOut}
          style={[styles.signOutBtn, { backgroundColor: c.surface, borderColor: c.hair }]}
        >
          <Ionicons name="log-out-outline" size={17} color={c.semantic.negative} />
          <Text style={{ fontSize: 14, fontWeight: '700', color: c.semantic.negative }}>
            {t('profile.sign_out')}
          </Text>
        </Pressable>
      </View>

      {/*
        * Borrar cuenta va DEBAJO de cerrar sesión y en la misma jerarquía
        * visual: las dos tiendas exigen que se llegue desde la app y que no
        * esté escondido detrás de «contactá al soporte».
        */}
      <View style={{ paddingHorizontal: Spacing.screenPad, paddingTop: 10 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/settings/borrar-cuenta' as any)}
          style={[styles.signOutBtn, { backgroundColor: 'transparent', borderColor: 'transparent' }]}
        >
          <Ionicons name="trash-outline" size={16} color={c.textTertiary} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: c.textTertiary }}>
            {t('account_delete.row')}
          </Text>
        </Pressable>
      </View>

      {__DEV__ && (
        <>
          <SectionLabel label="DEV" />
          <Band>
            <LinkRow label="Identidad de cuentas"  icon="finger-print-outline"  onPress={() => router.push('/debug/identity' as any)} />
            <LinkRow label="Relay (buzón)"         icon="cloud-upload-outline"  onPress={() => router.push('/debug/relay' as any)} last />
          </Band>
        </>
      )}

      <Text style={[Typography.caption, styles.version, { color: c.textTertiary }]}>
        {t('profile.version', { version: APP_VERSION })}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  signOutBtn:   {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 48, borderRadius: Radius.lg, borderWidth: 1,
  },
  version:      { textAlign: 'center', marginTop: 18 },
});
