import React from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { hueForUser } from '@/src/utils/hueForUser';
import { Avatar } from './Avatar';

export function BottomSheet({
  visible, onClose, children,
}: {
  visible: boolean; onClose: () => void; children: React.ReactNode;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.sheet, { backgroundColor: c.surface }]}>
            <View style={[styles.sheetHandle, { backgroundColor: c.borderStrong }]} />
            {children}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export function SheetOption({
  icon, label, sublabel, selected, onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  sublabel?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <Pressable
      onPress={onPress}
      style={[styles.sheetOption, { backgroundColor: selected ? c.brand.primarySoft : c.surfaceSunken }]}
    >
      <Ionicons name={icon} size={18} color={selected ? c.brand.primaryOnSoft : c.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={[Typography.bodyM, { color: selected ? c.brand.primaryOnSoft : c.text, fontWeight: '600' }]}>
          {label}
        </Text>
        {sublabel && (
          <Text style={[Typography.bodyS, { color: selected ? c.brand.primaryOnSoft : c.textTertiary }]}>
            {sublabel}
          </Text>
        )}
      </View>
      {selected && <Ionicons name="checkmark" size={18} color={c.brand.primaryOnSoft} />}
    </Pressable>
  );
}

export function SheetOptionAvatar({
  userId, name, selected, onPress,
}: {
  userId: string; name: string; selected: boolean; onPress: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <Pressable
      onPress={onPress}
      style={[styles.sheetOption, { backgroundColor: selected ? c.brand.primarySoft : c.surfaceSunken }]}
    >
      <Avatar name={name} hue={hueForUser(userId)} size={28} />
      <Text style={[Typography.bodyM, { flex: 1, color: selected ? c.brand.primaryOnSoft : c.text, fontWeight: '600' }]}>
        {name}
      </Text>
      {selected && <Ionicons name="checkmark" size={18} color={c.brand.primaryOnSoft} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  modalRoot:   { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.38)' },
  sheet:       {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: Spacing[6], paddingTop: Spacing[3], gap: Spacing[2],
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: Spacing[2] },
  sheetOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: Radius.md,
  },
});
