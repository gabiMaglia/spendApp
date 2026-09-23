import React from 'react';
import type { TextInput as RNTextInput } from 'react-native';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Radius } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { BottomSheet } from '@/src/components/Sheet';

/** Hoja "Nuevo contacto" — alta manual por nombre, sin QR. */
export function AddContactSheet({
  visible, onClose, name, onChangeName, inputRef, onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  name: string;
  onChangeName: (v: string) => void;
  inputRef: React.RefObject<RNTextInput | null>;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {/* Sin `KeyboardAvoidingView` propio (PO 2026-09-22): el `BottomSheet`
          compartido ya lo resuelve — uno acá adentro sumaba SU empuje al
          del `BottomSheet`, empujando la hoja el doble de lo que hacía
          falta. */}
      <Text style={[Typography.h3, { color: c.text, marginBottom: 6 }]}>{t('friends.new_contact')}</Text>
      <Text style={[Typography.bodyS, { color: c.textSecondary, marginBottom: 20 }]}>
        {t('friends.new_contact_hint')}
      </Text>
      <View style={[styles.inputRow, { backgroundColor: c.bgGrouped, borderColor: c.hair }]}>
        <Ionicons name="person-outline" size={18} color={c.textTertiary} />
        <TextInput
          ref={inputRef}
          value={name}
          onChangeText={onChangeName}
          placeholder={t('friends.name_placeholder')}
          placeholderTextColor={c.textTertiary}
          style={[Typography.bodyM, { flex: 1, color: c.text, padding: 0 }]}
          returnKeyType="done"
          onSubmitEditing={onConfirm}
          autoFocus
        />
      </View>
      <Pressable
        onPress={onConfirm}
        disabled={!name.trim()}
        style={[styles.confirmBtn, {
          backgroundColor: name.trim() ? c.brand.primary : c.bgGrouped,
          marginTop: 14,
        }]}
      >
        <Text style={{
          fontSize: 15, fontWeight: '700',
          color: name.trim() ? '#fff' : c.textTertiary,
        }}>
          {t('common.add')}
        </Text>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: Radius.md, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 13, marginBottom: 4,
  },
  confirmBtn: { borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
});
