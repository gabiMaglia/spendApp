import React, { useMemo, useRef, useState } from 'react';
import {
  Alert, Animated, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
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
import { useFx } from '@/src/store/useFx';
import { sumConverted } from '@/src/services/fxTotals';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useGlobalPersonBalances } from '@/src/store/selectors';
import { hapticSuccess, hapticWarning } from '@/src/utils/haptics';
import { UserAvatar } from '@/src/components/UserAvatar';
import { Fab, FabRow } from '@/src/components/Fab';
import { EmptyState } from '@/src/components/EmptyState';
import { BottomSheet } from '@/src/components/Sheet';
import { Band, BandRow, SectionLabel, SplitStat } from '@/src/components/Band';
import { TabHeader } from '@/src/components/TabHeader';
import { useHeaderPadding } from '@/src/components/CollapsibleHeader';
import { syncedNow } from '@/src/utils/syncedClock';
import { esYo } from '@/src/store/identityAlias';

export default function FriendsScreen() {
  const { t } = useTranslation();
  const headerPad = useHeaderPadding();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { currentUser } = useAuthStore();
  const { users, addOrUpdateUser, removeUser } = useUserStore();

  const personBalances = useGlobalPersonBalances(currentUser?.id ?? '');
  const scrollY = useRef(new Animated.Value(0)).current;

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<TextInput>(null);

  const contacts = useMemo(
    () => users.filter(u => !u.isDeleted && !esYo(u.id)),
    // `currentUser` no aparece en el cuerpo pero la dependencia es REAL: `esYo`
    // lee la sesión activa, así que cambiar de cuenta tiene que recalcular esto.
    // El linter no puede ver esa dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, currentUser],
  );

  const { fx, display: cur } = useFx();
  const deben = sumConverted(
    personBalances.filter(p => p.amount > 0).map(p => ({ currency: p.currency, minor: p.amount })),
    cur, fx,
  );
  const debo = sumConverted(
    personBalances.filter(p => p.amount < 0).map(p => ({ currency: p.currency, minor: -p.amount })),
    cur, fx,
  );
  const owedToYou = deben.totalMinor;
  const youOwe    = debo.totalMinor;

  function handleAddContact() {
    const name = newName.trim();
    if (!name) return;
    hapticSuccess();
    addOrUpdateUser({
      id:           uuidv4(),
      name,
      email:        '',
      authProvider: 'google',
      updatedAt:    syncedNow(),
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
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: c.bg }]}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
        contentContainerStyle={{ paddingTop: headerPad, paddingBottom: 150, flexGrow: 1 }}
      >
        <Text style={[Typography.display, styles.title, { color: c.text }]}>{t('friends.title')}</Text>

        {(owedToYou > 0 || youOwe > 0) && (
          <SplitStat
            items={[
              { label: t('friends.owed_to_you'), value: formatMoney(owedToYou, cur), color: c.semantic.positive },
              { label: t('friends.you_owe'),     value: formatMoney(youOwe, cur),    color: c.textSecondary },
            ]}
          />
        )}

        {contacts.length === 0 ? (
          <EmptyState
            iconName="people-outline"
            title={t('friends.empty_title')}
            body={t('friends.empty_body')}
          />
        ) : (
          <>
            <SectionLabel label={t('friends.contacts_count', { count: contacts.length })} />
            <Band>
              {contacts.map((contact, i) => {
                const balance = personBalances.find(b => b.userId === contact.id);
                return (
                  <ContactRow
                    key={contact.id}
                    userId={contact.id}
                    name={contact.name}
                    amount={balance?.amount}
                    currency={balance?.currency ?? 'ARS'}
                    last={i === contacts.length - 1}
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
            </Band>
            <Text style={[Typography.caption, styles.footnote, { color: c.textTertiary }]}>
              {t('friends.qr_note')}
            </Text>
          </>
        )}
      </Animated.ScrollView>

      <TabHeader title={t('friends.title')} scrollY={scrollY} />

      <FabRow>
        <Fab
          onPress={() => router.push('/contact/add' as any)}
          icon="qr-code-outline"
          label={t('friends.add_by_qr')}
          backgroundColor={c.brand.primary}
        />
      </FabRow>

      <BottomSheet visible={showAdd} onClose={() => { setShowAdd(false); setNewName(''); }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Text style={[Typography.h3, { color: c.text, marginBottom: 6 }]}>{t('friends.new_contact')}</Text>
          <Text style={[Typography.bodyS, { color: c.textSecondary, marginBottom: 20 }]}>
            {t('friends.new_contact_hint')}
          </Text>
          <View style={[styles.inputRow, { backgroundColor: c.bgGrouped, borderColor: c.hair }]}>
            <Ionicons name="person-outline" size={18} color={c.textTertiary} />
            <TextInput
              ref={inputRef}
              value={newName}
              onChangeText={setNewName}
              placeholder={t('friends.name_placeholder')}
              placeholderTextColor={c.textTertiary}
              style={[Typography.bodyM, { flex: 1, color: c.text, padding: 0 }]}
              returnKeyType="done"
              onSubmitEditing={handleAddContact}
              autoFocus
            />
          </View>
          <Pressable
            onPress={handleAddContact}
            disabled={!newName.trim()}
            style={[styles.confirmBtn, {
              backgroundColor: newName.trim() ? c.brand.primary : c.bgGrouped,
              marginTop: 14,
            }]}
          >
            <Text style={{
              fontSize: 15, fontWeight: '700',
              color: newName.trim() ? '#fff' : c.textTertiary,
            }}>
              {t('common.add')}
            </Text>
          </Pressable>
        </KeyboardAvoidingView>
      </BottomSheet>
    </SafeAreaView>
  );
}

function ContactRow({
  userId, name, amount, currency, onRemove, onSettle, last,
}: {
  userId: string; name: string;
  amount?: number; currency: string;
  onRemove: () => void; onSettle: () => void; last?: boolean;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const hasBalance = amount !== undefined && amount !== 0;
  const positive   = (amount ?? 0) > 0;
  const canSettle  = amount !== undefined && amount < 0;

  return (
    <BandRow last={last}>
      <UserAvatar userId={userId} name={name} size={42} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[Typography.bodyL, { color: c.text }]} numberOfLines={1}>{name}</Text>
        {hasBalance ? (
          <Text
            style={{
              fontSize: 11.5, fontWeight: '600',
              color: positive ? c.semantic.positive : c.semantic.negative,
            }}
            numberOfLines={1}
          >
            {positive ? t('friends.owes_you') : t('friends.you_owe_them')}
            {formatMoney(Math.abs(amount!), currency as any)}
          </Text>
        ) : (
          <Text style={{ fontSize: 11.5, fontWeight: '600', color: c.textTertiary }}>
            {t('common.settled')}
          </Text>
        )}
      </View>
      {canSettle && (
        <Pressable onPress={onSettle} style={[styles.actionChip, { backgroundColor: c.brand.primarySoft }]}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: c.brand.primary }}>
            {t('friends.settle')}
          </Text>
        </Pressable>
      )}
      <Pressable onPress={onRemove} hitSlop={8}>
        <Ionicons name="trash-outline" size={16} color={c.textTertiary} />
      </Pressable>
    </BandRow>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1 },
  title:      { paddingHorizontal: Spacing.screenPad, paddingBottom: 16 },
  footnote:   { paddingHorizontal: Spacing.screenPad, paddingTop: 14, lineHeight: 17 },
  actionChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: Radius.full },
  inputRow:   {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: Radius.md, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 13, marginBottom: 4,
  },
  confirmBtn: { borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
});
