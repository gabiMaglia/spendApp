import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import type { RecurrenceValue } from '@/src/components/RecurrencePicker';
import { useSkin } from '@/src/skins/useSkin';
import { formatDate } from '@/src/screens/expense/repartoDeGasto';

/**
 * Barra de abajo del alta estilo Splitwise (feat/reskin, B4): fecha a la
 * izquierda; repetir, foto, archivo y nota a la derecha. El grupo ya no va
 * acá: está arriba, en «Con vos y». Repetir sólo al crear.
 */
export function BarraDeHerramientas({
  date, onOpenDate, recurrence, onOpenRecurrence, showRecurrence,
  receiptUri, onReceiptChange, note, onOpenNote,
}: {
  date: Date;
  onOpenDate: () => void;
  recurrence: RecurrenceValue;
  onOpenRecurrence: () => void;
  showRecurrence: boolean;
  receiptUri?: string;
  onReceiptChange: (uri: string) => void;
  note: string;
  onOpenNote: () => void;
}) {
  const { t } = useTranslation();
  const { skin } = useSkin();
  const c = skin.colors;

  async function camara() {
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!r.canceled && r.assets[0]) onReceiptChange(r.assets[0].uri);
  }
  async function archivo() {
    const r = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'] });
    if (!r.canceled && r.assets[0]) onReceiptChange(r.assets[0].uri);
  }

  const activo = (on: boolean) => (on ? c.brand.primary : c.textSecondary);

  return (
    <View style={[styles.barra, {
      backgroundColor: c.surfaceRaised, borderColor: c.edgeLight, borderRadius: skin.radius.panel,
      boxShadow: skin.elevation.e2.boxShadow,
    }]}>
      <Pressable testID="barra-fecha" onPress={onOpenDate} accessibilityRole="button" style={styles.chip}>
        <Ionicons name="calendar-outline" size={19} color={c.brand.primary} />
        <Text style={[Typography.bodyL, { color: c.text }]}>{formatDate(date)}</Text>
      </Pressable>
      <View style={styles.espacio} />
      {showRecurrence && (
        <Pressable
          testID="barra-repetir"
          onPress={onOpenRecurrence}
          accessibilityRole="button"
          accessibilityLabel={t('recurrence.label')}
          style={[styles.chip, recurrence !== null && { backgroundColor: c.brand.primarySoft }]}
        >
          <Ionicons name="repeat-outline" size={21} color={activo(recurrence !== null)} />
          {recurrence !== null && (
            <Text style={[Typography.bodyS, { color: c.brand.primary, fontWeight: '700' }]}>
              {t(`recurrence.${recurrence}`)}
            </Text>
          )}
        </Pressable>
      )}
      <Pressable onPress={camara} accessibilityRole="button" accessibilityLabel={t('expense.receipt_camera')} style={styles.icono}>
        <Ionicons name={receiptUri ? 'camera' : 'camera-outline'} size={21} color={activo(!!receiptUri)} />
      </Pressable>
      <Pressable onPress={archivo} accessibilityRole="button" accessibilityLabel={t('expense.receipt_file')} style={styles.icono}>
        <Ionicons name="attach-outline" size={21} color={c.textSecondary} />
      </Pressable>
      <Pressable onPress={onOpenNote} accessibilityRole="button" accessibilityLabel={t('expense.note')} style={styles.icono}>
        <Ionicons name={note ? 'document-text' : 'document-text-outline'} size={21} color={activo(!!note)} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  barra: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    marginHorizontal: Spacing.screenPad, marginBottom: Spacing[3], marginTop: Spacing[2],
    height: 56, paddingHorizontal: 6, borderWidth: 1, borderCurve: 'continuous',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    height: 44, paddingHorizontal: 12, borderRadius: 14,
  },
  espacio: { flex: 1 },
  icono: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
