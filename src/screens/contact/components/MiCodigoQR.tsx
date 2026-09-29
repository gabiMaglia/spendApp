import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColors } from '@/src/skins/useSkin';

type Props = {
  /** `null` mientras no hay sesión: se muestra «cargando». */
  nombre: string | null;
  qrData: string;
};

/** Pestaña «Mi QR»: el código propio con el nombre debajo. */
export function MiCodigoQR({ nombre, qrData }: Props) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={styles.qrContent}>
      {nombre !== null ? (
        <>
          <View style={[styles.qrCard, { backgroundColor: '#fff' }]}>
            <QRCode
              value={qrData}
              size={220}
              color="#0A1A22"
              backgroundColor="#fff"
            />
          </View>
          <Text style={[Typography.h3, { color: c.text, marginTop: Spacing[4] }]}>
            {nombre}
          </Text>
          <Text style={[Typography.bodyM, { color: c.textSecondary, marginTop: 4, textAlign: 'center' }]}>
            {t('contact.my_qr_hint')}
          </Text>

        </>
      ) : (
        <Text style={[Typography.bodyM, { color: c.textTertiary }]}>{t('common.loading')}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  qrContent:  {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    // Lugar para el botón flotante de compartir (48 de alto + su separación del borde),
    // así el QR no queda debajo.
    paddingHorizontal: Spacing.screenPad, paddingBottom: 96,
  },
  qrCard:     {
    padding: 24, borderRadius: Radius.xl,
    boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
  },
});
