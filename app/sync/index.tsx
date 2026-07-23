import React, { useState, useEffect } from 'react';
import {
  Alert, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { buildDelta, deltaToQRString, parseDeltaFromQR, applyDelta } from '@/src/sync/useSyncQR';
import { useTranslation } from 'react-i18next';

type Mode = 'choose' | 'show' | 'scan';

export default function SyncQRScreen() {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const c = Colors[scheme];
  const { currentUser } = useAuthStore();

  const [mode, setMode] = useState<Mode>('choose');
  const [qrValue, setQrValue] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (mode === 'show' && currentUser) {
      const delta = buildDelta(currentUser.id);
      setQrValue(deltaToQRString(delta));
    }
  }, [mode, currentUser]);

  async function handleStartScan() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(t('sync.perm_required_title'), t('sync.perm_required_body'));
        return;
      }
    }
    setScanned(false);
    setMode('scan');
  }

  function handleBarCodeScanned({ data }: { data: string }) {
    if (scanned) return;
    setScanned(true);

    try {
      const delta = parseDeltaFromQR(data);
      applyDelta(delta, currentUser?.id ?? '');
      Alert.alert(
        t('sync.success_title'),
        t('sync.success_body'),
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch {
      Alert.alert(
        t('sync.invalid_title'),
        t('sync.invalid_body'),
        [{ text: t('common.retry'), onPress: () => setScanned(false) }],
      );
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.borderHair }]}>
        <Pressable onPress={() => mode === 'choose' ? router.back() : setMode('choose')} hitSlop={12}>
          <Ionicons name={mode === 'choose' ? 'close' : 'arrow-back'} size={24} color={c.text} />
        </Pressable>
        <Text style={[Typography.h3, { color: c.text }]}>{t('sync.qr_title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Elegir modo */}
      {mode === 'choose' && (
        <ScrollView contentContainerStyle={styles.chooseContainer}>
          <View style={[styles.infoCard, { backgroundColor: c.brand.primarySoft }]}>
            <Ionicons name="sync-outline" size={28} color={c.brand.primary} />
            <Text style={[Typography.bodyM, { color: c.brand.primaryOnSoft, fontWeight: '600', marginTop: 8 }]}>
              {t('sync.how_title')}
            </Text>
            <Text style={[Typography.bodyS, { color: c.brand.primaryOnSoft, marginTop: 4, textAlign: 'center', opacity: 0.85 }]}>
              {t('sync.how_body')}
            </Text>
          </View>

          {/* Sync automática por WebRTC (QR-pairing) */}
          <Pressable
            onPress={() => router.push('/sync/webrtc' as any)}
            style={[styles.modeBtn, { backgroundColor: c.surface, borderColor: c.brand.primary }]}
          >
            <View style={[styles.modeIcon, { backgroundColor: c.brand.primary }]}>
              <Ionicons name="flash-outline" size={26} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[Typography.bodyL, { color: c.text, fontWeight: '600' }]}>
                {t('sync.pair_title')}
              </Text>
              <Text style={[Typography.bodyS, { color: c.textTertiary, marginTop: 2 }]}>
                {t('sync.pair_role_offer_sub')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={c.textTertiary} />
          </Pressable>

          <Pressable
            onPress={() => setMode('show')}
            style={[styles.modeBtn, { backgroundColor: c.surface, borderColor: c.borderHair }]}
          >
            <View style={[styles.modeIcon, { backgroundColor: c.brand.primarySoft }]}>
              <Ionicons name="qr-code-outline" size={26} color={c.brand.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[Typography.bodyL, { color: c.text, fontWeight: '600' }]}>
                {t('sync.show_my_qr')}
              </Text>
              <Text style={[Typography.bodyS, { color: c.textTertiary, marginTop: 2 }]}>
                {t('sync.show_my_qr_sub')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={c.textTertiary} />
          </Pressable>

          <Pressable
            onPress={handleStartScan}
            style={[styles.modeBtn, { backgroundColor: c.surface, borderColor: c.borderHair }]}
          >
            <View style={[styles.modeIcon, { backgroundColor: c.brand.accentSoft }]}>
              <Ionicons name="scan-outline" size={26} color={c.brand.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[Typography.bodyL, { color: c.text, fontWeight: '600' }]}>
                {t('sync.scan_qr')}
              </Text>
              <Text style={[Typography.bodyS, { color: c.textTertiary, marginTop: 2 }]}>
                {t('sync.scan_qr_sub')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={c.textTertiary} />
          </Pressable>

          <Text style={[Typography.caption, { color: c.textTertiary, textAlign: 'center', marginTop: 8 }]}>
            {t('sync.both_steps_note')}
          </Text>
        </ScrollView>
      )}

      {/* Mostrar QR */}
      {mode === 'show' && qrValue !== '' && (
        <View style={styles.qrContainer}>
          <Text style={[Typography.bodyM, { color: c.textSecondary, textAlign: 'center', marginBottom: 24 }]}>
            {t('sync.show_hint')}
          </Text>
          <View style={[styles.qrWrapper, { backgroundColor: '#fff', borderColor: c.borderHair }]}>
            <QRCode
              value={qrValue}
              size={240}
              color="#000"
              backgroundColor="#fff"
            />
          </View>
          <Text style={[Typography.caption, { color: c.textTertiary, textAlign: 'center', marginTop: 20 }]}>
            {t('sync.qr_includes')}
          </Text>
          <Pressable
            onPress={handleStartScan}
            style={[styles.secondaryBtn, { borderColor: c.brand.primary }]}
          >
            <Ionicons name="scan-outline" size={18} color={c.brand.primary} />
            <Text style={[Typography.bodyM, { color: c.brand.primary, fontWeight: '600' }]}>
              {t('sync.now_scan_theirs')}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Escáner */}
      {mode === 'scan' && (
        <View style={{ flex: 1 }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          />
          <View style={styles.scanOverlay} pointerEvents="none">
            <View style={[styles.scanFrame, { borderColor: '#fff' }]} />
            <Text style={[Typography.bodyM, { color: '#fff', marginTop: 20, textAlign: 'center' }]}>
              {t('sync.scan_other_hint')}
            </Text>
          </View>
          {scanned && (
            <View style={[styles.scannedBanner, { backgroundColor: c.brand.primary }]}>
              <Text style={[Typography.bodyM, { color: '#fff' }]}>{t('sync.processing')}</Text>
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:            { flex: 1 },
  header:          {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chooseContainer: { padding: Spacing.screenPad, gap: 14 },
  infoCard:        { borderRadius: Radius.lg, padding: 20, alignItems: 'center' },
  modeBtn:         {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 16, borderRadius: Radius.lg, borderWidth: 1,
  },
  modeIcon:        { width: 50, height: 50, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  qrContainer:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.screenPad },
  qrWrapper:       { padding: 20, borderRadius: Radius.lg, borderWidth: 1 },
  secondaryBtn:    {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 24, paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: Radius.full, borderWidth: 1.5,
  },
  scanOverlay:     { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  scanFrame:       { width: 220, height: 220, borderWidth: 3, borderRadius: 16 },
  scannedBanner:   { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, alignItems: 'center' },
});
