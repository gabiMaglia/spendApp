import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { hapticLight, hapticSuccess } from '@/src/utils/haptics';
import { contactInviteFromParams, isContactInviteExpired } from '@/src/sync/contactInvite';
import { publishContactClaim, processContactInvite } from '@/src/sync/contactInviteEngine';
import { deviceId, startRelay } from '@/src/sync/relayEngine';
import { shortFingerprint } from '@/src/utils/keyFingerprint';

/**
 * Pantalla que recibe el link de contacto por invitación (T-096 · ADR-015):
 * `spendapp://contact/claim?...`. Mismo patrón que `app/groups/join.tsx`: no
 * es instantáneo, porque el secreto real recién llega cuando quien compartió
 * el link procesa mi reclamo — puede tener la app cerrada.
 */

const ESPERA_MS = 25_000;
const REINTENTO_MS = 3_000;

type Estado = 'listo' | 'entrando' | 'entre' | 'esperando';

export default function ContactClaimScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { t } = useTranslation();

  const params = useLocalSearchParams();
  const currentUser = useAuthStore(s => s.currentUser);

  const invite = useMemo(() => contactInviteFromParams(params as Record<string, unknown>), [params]);
  const [estado, setEstado] = useState<Estado>('listo');
  const vivo = useRef(true);

  useEffect(() => () => { vivo.current = false; }, []);

  async function handleAdd() {
    if (!invite || estado !== 'listo') return;
    hapticLight();
    setEstado('entrando');

    await publishContactClaim(invite, deviceId());
    void startRelay();

    const limite = Date.now() + ESPERA_MS;
    while (vivo.current && Date.now() < limite) {
      const huboNovedad = await processContactInvite(invite, deviceId());
      if (huboNovedad) {
        if (!vivo.current) return;
        hapticSuccess();
        setEstado('entre');
        return;
      }
      await new Promise(r => setTimeout(r, REINTENTO_MS));
    }

    if (vivo.current) setEstado('esperando');
  }

  function cerrar() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/friends');
  }

  const contenido = () => {
    if (!invite) return mensaje('alert-circle-outline', c.semantic.error, t('contact.claim.invalid_title'), t('contact.claim.invalid_body'));
    if (isContactInviteExpired(invite)) return mensaje('time-outline', c.semantic.error, t('contact.claim.expired_title'), t('contact.claim.expired_body'));
    if (!currentUser) return mensaje('person-outline', c.textSecondary, t('contact.claim.need_login_title'), t('contact.claim.need_login_body'));

    if (estado === 'entre') {
      return (
        <>
          {mensaje('checkmark-circle-outline', c.semantic.positive, t('contact.claim.added_title'), t('contact.claim.added_body', { name: invite.fromName }))}
          <Pressable accessibilityRole="button" onPress={cerrar} style={[styles.cta, { backgroundColor: c.brand.primary }]}>
            <Text style={[Typography.bodyM, styles.ctaText]}>{t('common.close')}</Text>
          </Pressable>
        </>
      );
    }

    if (estado === 'esperando') {
      return (
        <>
          {mensaje('hourglass-outline', c.textSecondary, t('contact.claim.pending_title'), t('contact.claim.pending_body', { name: invite.fromName }))}
          <Pressable accessibilityRole="button" onPress={cerrar} style={[styles.cta, { backgroundColor: c.brand.primary }]}>
            <Text style={[Typography.bodyM, styles.ctaText]}>{t('common.close')}</Text>
          </Pressable>
        </>
      );
    }

    return (
      <>
        <View style={[styles.icon, { backgroundColor: c.brand.primary + '1A' }]}>
          <Ionicons name="person-add-outline" size={32} color={c.brand.primary} />
        </View>
        <Text style={[Typography.h2, styles.centro, { color: c.text }]}>
          {t('contact.claim.intro', { name: invite.fromName })}
        </Text>
        {invite.inviterFingerprint !== '' && (
          <Text style={[Typography.caption, styles.centro, { color: c.textSecondary }]}>
            {t('contact.claim.inviter_fingerprint', { fingerprint: shortFingerprint(invite.inviterFingerprint) })}
          </Text>
        )}

        <Pressable
          accessibilityRole="button"
          disabled={estado === 'entrando'}
          onPress={handleAdd}
          style={[styles.cta, { backgroundColor: c.brand.primary, opacity: estado === 'entrando' ? 0.6 : 1 }]}
        >
          {estado === 'entrando'
            ? <ActivityIndicator color="#fff" />
            : <Text style={[Typography.bodyM, styles.ctaText]}>{t('contact.claim.accept')}</Text>}
        </Pressable>

        {estado === 'entrando' && (
          <Text style={[Typography.caption, styles.centro, { color: c.textSecondary }]}>
            {t('contact.claim.waiting_key')}
          </Text>
        )}
      </>
    );
  };

  function mensaje(icon: keyof typeof Ionicons.glyphMap, color: string, titulo: string, cuerpo: string) {
    return (
      <>
        <View style={[styles.icon, { backgroundColor: color + '1A' }]}>
          <Ionicons name={icon} size={32} color={color} />
        </View>
        <Text style={[Typography.h3, styles.centro, { color: c.text }]}>{titulo}</Text>
        <Text style={[Typography.bodyS, styles.centro, { color: c.textSecondary }]}>{cuerpo}</Text>
      </>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={cerrar} hitSlop={12} accessibilityRole="button">
          <Ionicons name="close" size={24} color={c.text} />
        </Pressable>
      </View>
      <View style={styles.body}>{contenido()}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1 },
  header:  { paddingHorizontal: Spacing.screenPad, height: 52, justifyContent: 'center' },
  body:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing[3], paddingHorizontal: Spacing[7] },
  icon:    { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  centro:  { textAlign: 'center' },
  cta:     {
    marginTop: Spacing[5], height: 52, paddingHorizontal: Spacing[7],
    borderRadius: Radius.lg, minWidth: 200,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
