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

type Mode = 'choose' | 'show' | 'scan';

export default function SyncQRScreen() {
  const scheme = useColorScheme() ?? 'light';
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
        Alert.alert('Permiso requerido', 'Necesitamos acceso a la cámara para escanear el QR.');
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
        'Sincronización exitosa',
        'Los datos del otro dispositivo fueron importados correctamente.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch {
      Alert.alert(
        'QR inválido',
        'Este código QR no corresponde a un sync de SplitP2P.',
        [{ text: 'Reintentar', onPress: () => setScanned(false) }],
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
        <Text style={[Typography.h3, { color: c.text }]}>Sincronizar</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Elegir modo */}
      {mode === 'choose' && (
        <ScrollView contentContainerStyle={styles.chooseContainer}>
          <View style={[styles.infoCard, { backgroundColor: c.brand.primarySoft }]}>
            <Ionicons name="sync-outline" size={28} color={c.brand.primary} />
            <Text style={[Typography.bodyM, { color: c.brand.primaryOnSoft, fontWeight: '600', marginTop: 8 }]}>
              ¿Cómo funciona?
            </Text>
            <Text style={[Typography.bodyS, { color: c.brand.primaryOnSoft, marginTop: 4, textAlign: 'center', opacity: 0.85 }]}>
              Un dispositivo muestra el QR con sus datos y el otro lo escanea. Después hacen el proceso al revés para sincronizar en ambas direcciones.
            </Text>
          </View>

          <Pressable
            onPress={() => setMode('show')}
            style={[styles.modeBtn, { backgroundColor: c.surface, borderColor: c.borderHair }]}
          >
            <View style={[styles.modeIcon, { backgroundColor: c.brand.primarySoft }]}>
              <Ionicons name="qr-code-outline" size={26} color={c.brand.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[Typography.bodyL, { color: c.text, fontWeight: '600' }]}>
                Mostrar mi QR
              </Text>
              <Text style={[Typography.bodyS, { color: c.textTertiary, marginTop: 2 }]}>
                El otro dispositivo escanea este código
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
                Escanear QR
              </Text>
              <Text style={[Typography.bodyS, { color: c.textTertiary, marginTop: 2 }]}>
                Apuntá la cámara al QR del otro dispositivo
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={c.textTertiary} />
          </Pressable>

          <Text style={[Typography.caption, { color: c.textTertiary, textAlign: 'center', marginTop: 8 }]}>
            Para sincronizar en ambas direcciones, hacé los dos pasos: mostrá y escaneá.
          </Text>
        </ScrollView>
      )}

      {/* Mostrar QR */}
      {mode === 'show' && qrValue !== '' && (
        <View style={styles.qrContainer}>
          <Text style={[Typography.bodyM, { color: c.textSecondary, textAlign: 'center', marginBottom: 24 }]}>
            Mostrá este código al otro dispositivo para que lo escanee
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
            El QR incluye todos tus grupos, gastos y pagos
          </Text>
          <Pressable
            onPress={handleStartScan}
            style={[styles.secondaryBtn, { borderColor: c.brand.primary }]}
          >
            <Ionicons name="scan-outline" size={18} color={c.brand.primary} />
            <Text style={[Typography.bodyM, { color: c.brand.primary, fontWeight: '600' }]}>
              Ahora escanear el suyo
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
              Apuntá al QR del otro dispositivo
            </Text>
          </View>
          {scanned && (
            <View style={[styles.scannedBanner, { backgroundColor: c.brand.primary }]}>
              <Text style={[Typography.bodyM, { color: '#fff' }]}>Procesando...</Text>
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
