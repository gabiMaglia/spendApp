import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { v4 as uuidv4 } from 'uuid';
import { hapticSelection, hapticSuccess } from '@/src/utils/haptics';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { announceGroupToContacts } from '@/src/sync/relayEngine';
import { hueForUser } from '@/src/utils/hueForUser';
import { Avatar } from '@/src/components/Avatar';
import { useTranslation } from 'react-i18next';

const PRIMARY_CURRENCIES: CurrencyCode[] = ['ARS', 'USD', 'EUR', 'BRL'];

export default function NewGroupScreen() {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const c = Colors[scheme];

  const { currentUser } = useAuthStore();
  const { addGroup } = useGroupStore();
  const ensureKey = useGroupKeyStore(st => st.ensureKey);
  const { users } = useUserStore();

  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('ARS');
  const [selectedIds, setSelectedIds] = useState<string[]>(
    currentUser ? [currentUser.id] : [],
  );

  const contacts = useMemo(
    () => users.filter(u => !u.isDeleted && u.id !== currentUser?.id),
    [users, currentUser],
  );

  const hasContact = selectedIds.some(id => id !== currentUser?.id);
  const canSave    = name.trim().length > 0 && hasContact;

  function toggleContact(id: string) {
    hapticSelection();
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  }

  function handleSave() {
    if (!canSave || !currentUser) return;
    hapticSuccess();

    const memberIds = selectedIds.includes(currentUser.id)
      ? selectedIds
      : [currentUser.id, ...selectedIds];

    const id = uuidv4();
    addGroup({
      id,
      name:          name.trim(),
      memberIds,
      currency,
      createdAt:     Date.now(),
      createdById:   currentUser.id,
      deletionVotes: [],
      updatedAt:     Date.now(),
      isDeleted:     false,
    });

    // La clave del grupo y su reparto a los contactos que ya escaneaste. Es lo
    // que hace que el grupo le aparezca al otro sin que tenga que hacer nada.
    ensureKey(id);
    void announceGroupToContacts(id);

    router.back();
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        {/* Header */}
        <View style={[styles.header, { borderBottomColor: c.borderHair }]}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerSide}>
            <Ionicons name="close" size={24} color={c.text} />
          </Pressable>
          <Text style={[Typography.h3, { color: c.text }]}>{t('groups.new_title')}</Text>
          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            hitSlop={12}
            style={styles.headerSide}
          >
            <Text style={[Typography.bodyM, {
              color: canSave ? c.brand.primary : c.textDisabled,
              fontWeight: '700',
              textAlign: 'right',
            }]}>
              {t('common.create')}
            </Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Group name */}
          <View style={[styles.inputCard, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
            <Ionicons name="people-outline" size={18} color={c.textTertiary} />
            <TextInput
              placeholder={t('groups.name_placeholder')}
              placeholderTextColor={c.textTertiary}
              value={name}
              onChangeText={setName}
              style={[Typography.bodyL, styles.nameInput, { color: c.text }]}
              returnKeyType="done"
              autoFocus
            />
          </View>

          {/* Currency */}
          <Text style={[Typography.label, styles.sectionLabel, { color: c.textTertiary }]}>
            {t('groups.currency_label')}
          </Text>
          <View style={styles.currencyRow}>
            {PRIMARY_CURRENCIES.map(code => (
              <Pressable
                key={code}
                onPress={() => { hapticSelection(); setCurrency(code); }}
                style={[
                  styles.currencyChip,
                  {
                    backgroundColor: currency === code ? c.brand.primary : c.surface,
                    borderColor:     currency === code ? c.brand.primary : c.borderHair,
                  },
                ]}
              >
                <Text style={[Typography.bodyS, {
                  color:      currency === code ? '#fff' : c.text,
                  fontWeight: '700',
                }]}>
                  {code}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Members */}
          <Text style={[Typography.label, styles.sectionLabel, { color: c.textTertiary }]}>
            {t('groups.participants_label')}
          </Text>

          {/* Yo — siempre fijo */}
          {currentUser && (
            <MemberRow
              id={currentUser.id}
              name={t('groups.you_suffix', { name: currentUser.name })}
              selected
              locked
              onToggle={() => {}}
            />
          )}

          {/* Contactos existentes */}
          {contacts.length === 0 ? (
            <View style={[styles.noContacts, { backgroundColor: c.surfaceSunken, borderColor: c.borderHair }]}>
              <Ionicons name="people-outline" size={24} color={c.textTertiary} />
              <Text style={[Typography.bodyM, { color: c.textTertiary, textAlign: 'center' }]}>
                {t('groups.no_contacts')}
              </Text>
              <Pressable
                onPress={() => router.back()}
                style={[styles.goContactsBtn, { borderColor: c.brand.primary }]}
              >
                <Text style={[Typography.bodyS, { color: c.brand.primary, fontWeight: '700' }]}>
                  {t('groups.go_contacts')}
                </Text>
              </Pressable>
            </View>
          ) : (
            contacts.map(u => (
              <MemberRow
                key={u.id}
                id={u.id}
                name={u.name}
                selected={selectedIds.includes(u.id)}
                locked={false}
                onToggle={() => toggleContact(u.id)}
              />
            ))
          )}

          {/* Hint si no seleccionó nadie */}
          {contacts.length > 0 && !hasContact && (
            <Text style={[Typography.bodyS, styles.hint, { color: c.textTertiary }]}>
              {t('groups.select_hint')}
            </Text>
          )}

          <View style={{ height: Spacing[8] }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MemberRow({
  id, name, selected, locked, onToggle,
}: {
  id: string; name: string; selected: boolean; locked: boolean; onToggle: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <Pressable
      onPress={locked ? undefined : onToggle}
      style={({ pressed }) => [
        styles.memberRow,
        { backgroundColor: c.surface, borderColor: c.borderHair, opacity: pressed && !locked ? 0.8 : 1 },
      ]}
    >
      <Avatar name={name} hue={hueForUser(id)} size={38} />
      <Text style={[Typography.bodyM, { flex: 1, color: c.text, fontWeight: '600' }]}>
        {name}
      </Text>
      <View style={[
        styles.check,
        {
          backgroundColor: selected ? c.brand.primary : 'transparent',
          borderColor:     selected ? c.brand.primary : c.border,
          opacity:         locked ? 0.4 : 1,
        },
      ]}>
        {selected && <Ionicons name="checkmark" size={14} color="#fff" />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1 },
  header:       {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide:   { width: 56 },
  scroll:       { paddingHorizontal: Spacing.screenPad, paddingTop: Spacing[4] },
  sectionLabel: { marginTop: Spacing[5], marginBottom: Spacing[2] },
  inputCard:    {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: Radius.lg, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  nameInput:    { flex: 1, padding: 0, fontWeight: '500' },
  currencyRow:  { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  currencyChip: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: Radius.full, borderWidth: 1 },
  memberRow:    {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, borderRadius: Radius.lg, borderWidth: 1,
    marginBottom: 8,
  },
  check:        {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  noContacts:   {
    alignItems: 'center', gap: 10,
    padding: Spacing[5], borderRadius: Radius.lg, borderWidth: 1,
    marginBottom: 8,
  },
  goContactsBtn:{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1.5 },
  hint:         { textAlign: 'center', marginTop: 4, marginBottom: 8 },
});
