import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView } from 'expo-camera';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColors } from '@/src/skins/useSkin';

type Props = {
  permitido: boolean;
  onPedirPermiso: () => void;
  scanned: boolean;
  onScanned: (r: { data: string }) => void;
  onReescanear: () => void;
};

/** Pestaña «Escanear»: pedido de permiso o cámara con el marco y «Escanear de nuevo». */
export function EscanerDeContacto({
  permitido, onPedirPermiso, scanned, onScanned, onReescanear,
}: Props) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={styles.scanContent}>
      {!permitido ? (
        <View style={styles.permBox}>
          <Ionicons name="camera-outline" size={48} color={c.textTertiary} />
          <Text style={[Typography.bodyM, { color: c.textSecondary, textAlign: 'center' }]}>
            {t('contact.cam_permission')}
          </Text>
          <Pressable
            onPress={onPedirPermiso}
            style={[styles.permBtn, { backgroundColor: c.brand.primary }]}
          >
            <Text style={[Typography.bodyM, { color: '#fff', fontWeight: '700' }]}>
              {t('contact.grant_permission')}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.cameraBox}>
          <CameraView
            style={StyleSheet.absoluteFillObject}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanned ? undefined : onScanned}
          />
          {/* Frame overlay */}
          <View style={styles.overlay}>
            <View style={styles.frame} />
            <Text style={[Typography.bodyM, { color: '#fff', marginTop: 24, textAlign: 'center' }]}>
              {t('contact.scan_hint')}
            </Text>
          </View>
          {scanned && (
            <Pressable
              onPress={onReescanear}
              style={[styles.rescanBtn, { backgroundColor: c.brand.primary }]}
            >
              <Text style={[Typography.bodyM, { color: '#fff', fontWeight: '700' }]}>
                {t('contact.rescan')}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scanContent:   { flex: 1 },
  cameraBox:     { flex: 1, position: 'relative' },
  overlay:       {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
  },
  frame:         {
    width: 220, height: 220, borderRadius: 16,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)',
  },
  rescanBtn:     {
    position: 'absolute', bottom: 40,
    alignSelf: 'center', paddingHorizontal: 28, paddingVertical: 14,
    borderRadius: Radius.full,
  },
  permBox:       {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: Spacing[8], gap: Spacing[4],
  },
  permBtn:       { paddingHorizontal: 24, paddingVertical: 12, borderRadius: Radius.full },
});
