import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColors } from '@/src/skins/useSkin';
import { formatDate } from '@/src/screens/expense/repartoDeGasto';

/**
 * Barra de utilidades de Nuevo gasto — píldora flotante despegada del borde
 * (rediseño 2026-09-22): comprobante (cámara / archivo), nota, grupo y fecha.
 * T-223: salió de `app/expense/new.tsx`.
 */
export function BarraUtilidades({
  receiptUri, onReceiptChange, note, onOpenNote, isIncome, isEditMode, groupName, onOpenGroup, date, onOpenDate,
}: {
  receiptUri?: string;
  onReceiptChange: (uri: string) => void;
  note: string;
  onOpenNote: () => void;
  isIncome: boolean;
  isEditMode: boolean;
  groupName: string;
  onOpenGroup: () => void;
  date: Date;
  onOpenDate: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();

  async function handleCamera() {
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets[0]) onReceiptChange(result.assets[0].uri);
  }

  async function handleFilePick() {
    const result = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'] });
    if (!result.canceled && result.assets[0]) onReceiptChange(result.assets[0].uri);
  }

  return (
    <View style={styles.utilityBarWrap}>
      <View style={[styles.utilityBar, { backgroundColor: c.surface, borderColor: c.hair }]}>
        <Pressable onPress={handleCamera} hitSlop={8} style={styles.utilityIconBtn}>
          <Ionicons
            name={receiptUri ? 'camera' : 'camera-outline'}
            size={20}
            color={receiptUri ? c.brand.primary : c.textSecondary}
          />
        </Pressable>
        <Pressable onPress={handleFilePick} hitSlop={8} style={styles.utilityIconBtn}>
          <Ionicons name="attach-outline" size={20} color={c.textSecondary} />
        </Pressable>
        <Pressable
          onPress={onOpenNote}
          hitSlop={8}
          style={[styles.utilityChip, { backgroundColor: note ? c.brand.primarySoft : c.bgGrouped }]}
        >
          <Ionicons
            name={note ? 'document-text' : 'document-text-outline'}
            size={16}
            color={note ? c.brand.primary : c.textSecondary}
          />
          <Text style={[Typography.bodyS, { fontWeight: '600', color: note ? c.brand.primary : c.textSecondary }]}>
            {t('expense.note')}
          </Text>
        </Pressable>

        {/* Selector de grupo — oculto en modo Ingreso (F-G2) */}
        {!isIncome && (
          <Pressable
            onPress={isEditMode ? undefined : onOpenGroup}
            style={[styles.utilityChip, { backgroundColor: c.bgGrouped, flex: 1 }]}
          >
            <Ionicons name="people-outline" size={14} color={c.textSecondary} />
            <Text
              style={[Typography.bodyS, { color: c.text, fontWeight: '600', flex: 1 }]}
              numberOfLines={1}
            >
              {groupName}
            </Text>
            {!isEditMode && <Ionicons name="chevron-up" size={14} color={c.textTertiary} />}
          </Pressable>
        )}

        <Pressable
          onPress={onOpenDate}
          style={[styles.utilityChip, { backgroundColor: c.bgGrouped }]}
        >
          <Ionicons name="calendar-outline" size={16} color={c.textSecondary} />
          <Text style={[Typography.bodyS, { color: c.text, fontWeight: '600' }]}>
            {formatDate(date)}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  utilityBarWrap: { paddingHorizontal: Spacing.screenPad, paddingBottom: Spacing[3], paddingTop: Spacing[2] },
  utilityBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: Radius.full, borderCurve: 'continuous', borderWidth: 1,
    paddingHorizontal: 10, height: 52,
  },
  utilityIconBtn: { padding: 4 },
  utilityChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.full,
  },
});
