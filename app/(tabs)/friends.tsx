import React, { useMemo, useRef, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { v4 as uuidv4 } from 'uuid';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useSyncStore } from '@/src/store/syncStore';
import { useUserStore } from '@/src/store/userStore';
import { useGlobalPersonBalances } from '@/src/store/selectors';
import { hueForUser } from '@/src/utils/hueForUser';
import { hapticLight, hapticSuccess, hapticWarning } from '@/src/utils/haptics';
import { Avatar } from '@/src/components/Avatar';
import { Fab, FabRow } from '@/src/components/Fab';
import { SyncStatusBadge } from '@/src/components/SyncStatusBadge';
import { EmptyState } from '@/src/components/EmptyState';
import { BottomSheet } from '@/src/components/Sheet';

export default function FriendsScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { state: syncState } = useSyncStore();
  const { currentUser } = useAuthStore();
  const { users, addOrUpdateUser, removeUser } = useUserStore();

  const personBalances = useGlobalPersonBalances(currentUser?.id ?? '');

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<TextInput>(null);

  const contacts = useMemo(
    () => users.filter(u => !u.isDeleted && u.id !== currentUser?.id),
    [users, currentUser],
  );

  const owedToYou = personBalances
    .filter(p => p.currency === 'ARS' && p.amount > 0)
    .reduce((s, p) => s + p.amount, 0);
  const youOwe = Math.abs(
    personBalances
      .filter(p => p.currency === 'ARS' && p.amount < 0)
      .reduce((s, p) => s + p.amount, 0),
  );

  function handleAddContact() {
    const name = newName.trim();
    if (!name) return;
    hapticSuccess();
    addOrUpdateUser({
      id:           uuidv4(),
      name,
      email:        '',
      authProvider: 'google',
      updatedAt:    Date.now(),
      isDeleted:    false,
      createdAt:    Date.now(),
    });
    setNewName('');
    setShowAdd(false);
  }

  function handleRemove(id: string, name: string) {
    hapticWarning();
    Alert.alert(
      t('friends.remove_title'),
      t('friends.remove_body', { name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => removeUser(id) },
      ],
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Header */}
        <View style={styles.header}>
          <SyncStatusBadge state={syncState} />
          <Pressable
            onPress={() => { hapticLight(); setShowAdd(true); }}
            style={[styles.iconBtn, { backgroundColor: c.surfaceSunken }]}
          >
            <Ionicons name="person-add-outline" size={18} color={c.text} />
          </Pressable>
        </View>

        {/* QR button */}
        <Pressable
          onPress={() => { hapticLight(); router.push('/contact/add' as any); }}
          style={[styles.qrBanner, { backgroundColor: c.surface, borderColor: c.borderHair }]}
        >
          <Ionicons name="qr-code-outline" size={22} color={c.brand.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[Typography.bodyM, { color: c.text, fontWeight: '700' }]}>
              {t('friends.add_by_qr')}
            </Text>
            <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
              {t('friends.add_by_qr_sub')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.textTertiary} />
        </Pressable>

        <Text style={[Typography.display, styles.title, { color: c.text }]}>{t('friends.title')}</Text>

        {/* Balance summary — solo si hay deudas */}
        {(owedToYou > 0 || youOwe > 0) && (
          <View style={[styles.summaryCard, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryCol}>
                <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase' }]}>
                  {t('friends.owed_to_you')}
                </Text>
                <Text style={[Typography.amountM, { color: c.semantic.positive, marginTop: 2 }]}>
                  {formatMoney(owedToYou, 'ARS')}
                </Text>
              </View>
              <View style={[styles.summaryDivider, { backgroundColor: c.borderHair }]} />
              <View style={styles.summaryCol}>
                <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase' }]}>
                  {t('friends.you_owe')}
                </Text>
                <Text style={[Typography.amountM, { color: c.semantic.negative, marginTop: 2 }]}>
                  {formatMoney(youOwe, 'ARS')}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Contacts list */}
        {contacts.length === 0 ? (
          <EmptyState
            iconName="people-outline"
            title={t('friends.empty_title')}
            body={t('friends.empty_body')}
            action={
              <Pressable
                onPress={() => { hapticLight(); router.push('/contact/add' as any); }}
                style={[styles.addBtn, { backgroundColor: c.brand.primary }]}
              >
                <Ionicons name="qr-code-outline" size={16} color="#fff" />
                <Text style={[Typography.bodyM, { color: '#fff', fontWeight: '700' }]}>
                  {t('friends.add_by_qr')}
                </Text>
              </Pressable>
            }
          />
        ) : (
          <View style={styles.list}>
            {contacts.map(contact => {
              const balance = personBalances.find(b => b.userId === contact.id);
              return (
                <ContactRow
                  key={contact.id}
                  userId={contact.id}
                  name={contact.name}
                  amount={balance?.amount}
                  currency={balance?.currency ?? 'ARS'}
                  onRemove={() => handleRemove(contact.id, contact.name)}
                  onSettle={() => router.push({
                    pathname: '/settle/new',
                    params: {
                      toId:      contact.id,
                      maxAmount: String(Math.abs(balance?.amount ?? 0)),
                      currency:  balance?.currency ?? 'ARS',
                    },
                  } as any)}
                />
              );
            })}
          </View>
        )}

        <View style={{ height: Spacing[9] }} />
      </ScrollView>

      {/* FAB — agregar contacto por QR */}
      <FabRow>
        <Fab
          onPress={() => router.push('/contact/add' as any)}
          icon="qr-code-outline"
          label={t('friends.add_by_qr')}
          backgroundColor={c.brand.primary}
        />
      </FabRow>

      {/* Sheet — nuevo contacto */}
      <BottomSheet
        visible={showAdd}
        onClose={() => { setShowAdd(false); setNewName(''); }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Text style={[Typography.h3, { color: c.text, marginBottom: 6 }]}>
            {t('friends.new_contact')}
          </Text>
          <Text style={[Typography.bodyS, { color: c.textSecondary, marginBottom: 20 }]}>
            {t('friends.new_contact_hint')}
          </Text>
          <View style={[styles.inputRow, { backgroundColor: c.surfaceSunken, borderColor: c.border }]}>
            <Ionicons name="person-outline" size={18} color={c.textTertiary} />
            <TextInput
              ref={inputRef}
              value={newName}
              onChangeText={setNewName}
              placeholder={t('friends.name_placeholder')}
              placeholderTextColor={c.textTertiary}
              style={[Typography.bodyL, { flex: 1, color: c.text, padding: 0 }]}
              returnKeyType="done"
              onSubmitEditing={handleAddContact}
              autoFocus
            />
          </View>
          <Pressable
            onPress={handleAddContact}
            disabled={!newName.trim()}
            style={[styles.confirmBtn, {
              backgroundColor: newName.trim() ? c.brand.primary : c.surfaceSunken,
              marginTop: 14,
            }]}
          >
            <Text style={[Typography.bodyM, {
              color: newName.trim() ? '#fff' : c.textTertiary,
              fontWeight: '700',
            }]}>
              {t('common.add')}
            </Text>
          </Pressable>
        </KeyboardAvoidingView>
      </BottomSheet>
    </SafeAreaView>
  );
}

function ContactRow({
  userId, name, amount, currency, onRemove, onSettle,
}: {
  userId: string; name: string;
  amount?: number; currency: string;
  onRemove: () => void; onSettle: () => void;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const hasBalance = amount !== undefined && amount !== 0;
  const positive   = (amount ?? 0) > 0;
  const canSettle  = amount !== undefined && amount < 0;

  return (
    <View style={[styles.contactRow, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
      <Avatar name={name} hue={hueForUser(userId)} size={44} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[Typography.bodyL, { color: c.text, fontWeight: '600' }]} numberOfLines={1}>
          {name}
        </Text>
        {hasBalance ? (
          <Text style={[Typography.bodyS, {
            color: positive ? c.semantic.positive : c.semantic.negative,
            fontWeight: '600',
          }]}>
            {positive ? t('friends.owes_you') : t('friends.you_owe_them')}
            {formatMoney(Math.abs(amount!), currency as any)}
          </Text>
        ) : (
          <Text style={[Typography.bodyS, { color: c.textTertiary }]}>
            {t('common.settled')}
          </Text>
        )}
      </View>
      <View style={styles.rowActions}>
        {canSettle && (
          <Pressable
            onPress={onSettle}
            style={[styles.actionChip, { backgroundColor: c.brand.primarySoft }]}
          >
            <Text style={[Typography.caption, { color: c.brand.primary, fontWeight: '700' }]}>
              {t('friends.settle')}
            </Text>
          </Pressable>
        )}
        <Pressable onPress={onRemove} hitSlop={8} style={styles.removeBtn}>
          <Ionicons name="trash-outline" size={18} color={c.textTertiary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1 },
  scroll:        { paddingTop: Spacing[2] },
  header:        {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingBottom: Spacing[3],
  },
  iconBtn:       { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title:         { paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[4] },
  summaryCard:   {
    marginHorizontal: Spacing.screenPad, marginBottom: Spacing[4],
    borderRadius: Radius.lg, borderWidth: 1, padding: Spacing[4],
  },
  summaryRow:    { flexDirection: 'row', alignItems: 'center' },
  summaryCol:    { flex: 1, alignItems: 'center' },
  summaryDivider:{ width: 1, height: 36, marginHorizontal: 4 },
  list:          { paddingHorizontal: Spacing.screenPad, gap: Spacing.cardGap },
  contactRow:    {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: Spacing.cardPad, borderRadius: Radius.lg, borderWidth: 1,
  },
  rowActions:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionChip:    { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.full },
  removeBtn:     { padding: 4 },
  addBtn:        {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: Radius.full,
  },
  qrBanner:      {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: Spacing.screenPad, marginBottom: Spacing[4],
    padding: Spacing[4], borderRadius: Radius.lg, borderWidth: 1,
  },
  // Sheet
  inputRow:      {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: Radius.lg, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 13,
    marginBottom: 4,
  },
  confirmBtn:    { borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
});
