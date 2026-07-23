import React, { useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { usePairingSession } from '@/src/p2p/usePairingSession';

type CameraMode = null | 'scan-offer' | 'scan-answer';

export default function WebRTCSyncScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { t } = useTranslation();
  const { currentUser } = useAuthStore();

  const session = usePairingSession(currentUser?.id ?? '');
  const { phase, role, mySignal, error, summary } = session;

  const [camera, setCamera] = useState<CameraMode>(null);
  const [scanned, setScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  async function openCamera(mode: Exclude<CameraMode, null>) {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert(t('sync.perm_required_title'), t('sync.perm_required_body'));
        return;
      }
    }
    setScanned(false);
    setCamera(mode);
  }

  function handleScan({ data }: { data: string }) {
    if (scanned) return;
    setScanned(true);
    const mode = camera;
    setCamera(null);
    if (mode === 'scan-offer') session.acceptOfferAndAnswer(data);
    else if (mode === 'scan-answer') session.acceptAnswer(data);
  }

  function handleClose() {
    session.reset();
    router.back();
  }

  function handleRetry() {
    session.reset();
    setCamera(null);
    setScanned(false);
  }

  // ── Render helpers ──────────────────────────────────────────────────────────
  const isBusy = phase === 'preparing' || phase === 'connecting' || phase === 'syncing';
  const busyLabel =
    phase === 'preparing'  ? t('sync.pair_preparing')
    : phase === 'connecting' ? t('sync.pair_connecting')
    : t('sync.pair_syncing');

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <View style={[styles.header, { borderBottomColor: c.borderHair }]}>
        <Pressable onPress={handleClose} hitSlop={12}>
          <Ionicons name="close" size={24} color={c.text} />
        </Pressable>
        <Text style={[Typography.h3, { color: c.text }]}>{t('sync.pair_title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Camera scanning */}
      {camera ? (
        <View style={{ flex: 1 }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            onBarcodeScanned={scanned ? undefined : handleScan}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          />
          <View style={styles.scanOverlay} pointerEvents="none">
            <View style={styles.scanFrame} />
            <Text style={[Typography.bodyM, styles.scanText]}>
              {t('sync.pair_scan_offer_hint')}
            </Text>
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {/* Error */}
          {phase === 'error' ? (
            <View style={styles.centerBox}>
              <Ionicons name="warning-outline" size={40} color={c.semantic.negative} />
              <Text style={[Typography.bodyM, { color: c.text, textAlign: 'center' }]}>
                {t(error ?? 'sync.pair_failed')}
              </Text>
              <Pressable onPress={handleRetry} style={[styles.primaryBtn, { backgroundColor: c.brand.primary }]}>
                <Text style={[Typography.bodyM, { color: '#fff', fontWeight: '700' }]}>{t('sync.pair_retry')}</Text>
              </Pressable>
            </View>

          /* Done */
          ) : phase === 'done' ? (
            <View style={styles.centerBox}>
              <Ionicons name="checkmark-circle" size={56} color={c.semantic.positive} />
              <Text style={[Typography.h3, { color: c.text }]}>{t('sync.pair_done')}</Text>
              <Text style={[Typography.bodyM, { color: c.textSecondary, textAlign: 'center' }]}>
                {t('sync.pair_done_records', { count: summary?.records ?? 0 })}
              </Text>
              <Pressable onPress={handleClose} style={[styles.primaryBtn, { backgroundColor: c.brand.primary }]}>
                <Text style={[Typography.bodyM, { color: '#fff', fontWeight: '700' }]}>{t('common.done')}</Text>
              </Pressable>
            </View>

          /* Busy: preparing / connecting / syncing */
          ) : isBusy ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={c.brand.primary} />
              <Text style={[Typography.bodyM, { color: c.textSecondary }]}>{busyLabel}</Text>
            </View>

          /* Awaiting peer: show MY QR */
          ) : phase === 'awaiting-peer' && mySignal ? (
            <View style={styles.centerBox}>
              <View style={[styles.qrWrapper, { backgroundColor: '#fff', borderColor: c.borderHair }]}>
                <QRCode value={mySignal} size={240} ecl="L" color="#000" backgroundColor="#fff" />
              </View>
              <Text style={[Typography.bodyM, { color: c.textSecondary, textAlign: 'center' }]}>
                {role === 'offer' ? t('sync.pair_show_offer_hint') : t('sync.pair_show_answer_hint')}
              </Text>
              {role === 'offer' && (
                <Pressable
                  onPress={() => openCamera('scan-answer')}
                  style={[styles.primaryBtn, { backgroundColor: c.brand.primary }]}
                >
                  <Ionicons name="scan-outline" size={18} color="#fff" />
                  <Text style={[Typography.bodyM, { color: '#fff', fontWeight: '700' }]}>
                    {t('sync.pair_scan_answer')}
                  </Text>
                </Pressable>
              )}
            </View>

          /* Idle: choose role */
          ) : (
            <>
              <Text style={[Typography.bodyM, { color: c.textSecondary, textAlign: 'center' }]}>
                {t('sync.pair_intro')}
              </Text>
              <Pressable
                onPress={() => session.startAsOfferer()}
                style={[styles.roleBtn, { backgroundColor: c.surface, borderColor: c.borderHair }]}
              >
                <View style={[styles.roleIcon, { backgroundColor: c.brand.primarySoft }]}>
                  <Ionicons name="qr-code-outline" size={24} color={c.brand.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[Typography.bodyL, { color: c.text, fontWeight: '600' }]}>{t('sync.pair_role_offer')}</Text>
                  <Text style={[Typography.bodyS, { color: c.textTertiary }]}>{t('sync.pair_role_offer_sub')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={c.textTertiary} />
              </Pressable>
              <Pressable
                onPress={() => openCamera('scan-offer')}
                style={[styles.roleBtn, { backgroundColor: c.surface, borderColor: c.borderHair }]}
              >
                <View style={[styles.roleIcon, { backgroundColor: c.brand.accentSoft }]}>
                  <Ionicons name="scan-outline" size={24} color={c.brand.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[Typography.bodyL, { color: c.text, fontWeight: '600' }]}>{t('sync.pair_role_answer')}</Text>
                  <Text style={[Typography.bodyS, { color: c.textTertiary }]}>{t('sync.pair_role_answer_sub')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={c.textTertiary} />
              </Pressable>
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body:   { padding: Spacing.screenPad, gap: 14 },
  centerBox: { alignItems: 'center', gap: 16, paddingTop: Spacing[6] },
  qrWrapper: { padding: 20, borderRadius: Radius.lg, borderWidth: 1 },
  roleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 16, borderRadius: Radius.lg, borderWidth: 1,
  },
  roleIcon: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 24, paddingVertical: 14, borderRadius: Radius.full,
  },
  scanOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  scanFrame:   { width: 240, height: 240, borderWidth: 3, borderColor: '#fff', borderRadius: 16 },
  scanText:    { color: '#fff', marginTop: 20, textAlign: 'center' },
});
