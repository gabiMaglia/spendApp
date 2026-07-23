import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { v4 as uuidv4 } from 'uuid';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAmountInput } from '@/src/hooks/useAmountInput';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { hapticSuccess, hapticWarning, hapticSelection } from '@/src/utils/haptics';
import { hueForUser } from '@/src/utils/hueForUser';
import { Avatar } from '@/src/components/Avatar';
import { BottomSheet, SheetOption, SheetOptionAvatar } from '@/src/components/Sheet';
import { useTranslation } from 'react-i18next';
import i18n from '@/src/i18n';

function formatDate(d: Date): string {
  const today     = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const dMid      = new Date(d);    dMid.setHours(0, 0, 0, 0);
  if (dMid.getTime() === today.getTime())     return i18n.t('common.today');
  if (dMid.getTime() === yesterday.getTime()) return i18n.t('common.yesterday');
  return d.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
}

export default function SettleNewScreen() {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const c = Colors[scheme];

  const { currentUser } = useAuthStore();
  const { addPayment } = usePaymentStore();
  const { getUserName } = useUserStore();
  const allGroups = useGroupStore(s => s.groups);

  // Params from friends tab: pre-fill who you're paying and how much
  const {
    toId:      paramToId,
    maxAmount: paramMaxStr,
    currency:  paramCurrency,
  } = useLocalSearchParams<{ toId?: string; maxAmount?: string; currency?: string }>();

  const isPrefilled  = Boolean(paramToId);
  // `paramMaxStr` viene de `friends.tsx` como `String(balance)` — ya es el
  // entero en menor unidad (ADR-002), NO texto locale-formateado: no pasa
  // por `parseMoney`.
  const maxAmount    = paramMaxStr ? Math.round(Number(paramMaxStr)) : undefined;
  const paramCur     = (paramCurrency ?? 'ARS') as CurrencyCode;

  // Only show groups relevant to the settle: both users must be members
  const groups = useMemo(() => {
    const active = allGroups.filter(g => !g.isDeleted);
    if (!isPrefilled || !currentUser || !paramToId) return active;
    const relevant = active.filter(g =>
      g.memberIds.includes(currentUser.id) && g.memberIds.includes(paramToId),
    );
    return relevant.length > 0 ? relevant : active;
  }, [allGroups, isPrefilled, currentUser, paramToId]);

  // Auto-select first group that matches currency when prefilled
  const defaultGroup = useMemo(() => {
    if (!isPrefilled) return groups[0];
    return groups.find(g => g.currency === paramCur) ?? groups[0];
  }, [groups, isPrefilled, paramCur]);

  const [groupId,   setGroupId]   = useState(defaultGroup?.id ?? '');
  // Moneda resuelta temprano — el input de monto (entero, menor unidad,
  // ADR-002) la necesita para parsear/formatear correctamente.
  const currencyForAmount: CurrencyCode =
    groups.find(g => g.id === groupId)?.currency ?? paramCur;
  const {
    text: amountStr,
    minor: amount,
    onChangeText: setAmountStr,
    onBlur: onAmountBlur,
    setMinor: setAmountMinor,
  } = useAmountInput(currencyForAmount, maxAmount ?? 0);
  const [fromId,    setFromId]    = useState(
    isPrefilled && currentUser ? currentUser.id : (defaultGroup?.memberIds[0] ?? ''),
  );
  const [toId, setToId] = useState(
    isPrefilled && paramToId ? paramToId : (defaultGroup?.memberIds.filter(uid => uid !== fromId)[0] ?? ''),
  );
  const [date,      setDate]      = useState(new Date());

  const [showGroup, setShowGroup] = useState(false);
  const [showFrom,  setShowFrom]  = useState(false);
  const [showTo,    setShowTo]    = useState(false);
  const [showDate,  setShowDate]  = useState(false);

  const group    = groups.find(g => g.id === groupId);
  const members  = group?.memberIds ?? [];
  const currency = currencyForAmount;
  const toOptions = members.filter(uid => uid !== fromId);

  const exceedsMax  = maxAmount !== undefined && amount > maxAmount;
  const canSave     = amount > 0 && !exceedsMax && fromId.length > 0 && toId.length > 0 && fromId !== toId && groupId.length > 0;

  function handleGroupChange(id: string) {
    hapticSelection();
    const g = groups.find(x => x.id === id);
    const mems = g?.memberIds ?? [];
    setGroupId(id);
    if (!isPrefilled) {
      const newFrom = currentUser && mems.includes(currentUser.id) ? currentUser.id : (mems[0] ?? '');
      const newTo   = mems.filter(uid => uid !== newFrom)[0] ?? '';
      setFromId(newFrom);
      setToId(newTo);
    }
    // Re-normaliza el texto del input a las reglas de decimales de la nueva
    // moneda (p.ej. si el nuevo grupo es CLP/PYG, sin decimales).
    setAmountMinor(amount);
    setShowGroup(false);
  }

  function handleFromChange(id: string) {
    hapticSelection();
    setFromId(id);
    if (toId === id) setToId(members.filter(uid => uid !== id)[0] ?? '');
    setShowFrom(false);
  }

  function handleSave() {
    if (!canSave || !currentUser) return;
    if (exceedsMax) { hapticWarning(); return; }
    hapticSuccess();
    addPayment({
      id:          uuidv4(),
      groupId,
      fromUserId:  fromId,
      toUserId:    toId,
      amount,
      currency,
      date:        date.getTime(),
      createdAt:   Date.now(),
      createdById: currentUser.id,
      updatedAt:   Date.now(),
      isDeleted:   false,
    });
    router.back();
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        {/* Header */}
        <View style={[styles.header, { borderBottomColor: c.borderHair }]}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn}>
            <Ionicons name="close" size={24} color={c.text} />
          </Pressable>
          <Text style={[Typography.h3, { color: c.text }]}>{t('settle.title')}</Text>
          <View style={styles.headerBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* Amount */}
          <View style={[styles.amountCard, { backgroundColor: c.surface, borderColor: exceedsMax ? c.semantic.negative : c.borderHair }]}>
            <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>
              {currency}
            </Text>
            <View style={styles.amountRow}>
              <Text style={[styles.currencySymbol, { color: c.textTertiary }]}>$</Text>
              <TextInput
                value={amountStr}
                onChangeText={setAmountStr}
                onBlur={onAmountBlur}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={c.textTertiary}
                style={[Typography.amountXL, { color: exceedsMax ? c.semantic.negative : c.text }]}
                returnKeyType="done"
              />
            </View>
            {maxAmount !== undefined && (
              <View style={[styles.maxHint, { backgroundColor: exceedsMax ? c.semantic.negativeSoft : c.surfaceSunken }]}>
                <Ionicons
                  name={exceedsMax ? 'warning-outline' : 'information-circle-outline'}
                  size={13}
                  color={exceedsMax ? c.semantic.negative : c.textTertiary}
                />
                <Text style={[Typography.caption, { color: exceedsMax ? c.semantic.negative : c.textTertiary }]}>
                  {exceedsMax
                    ? t('settle.max_exceeded', { amount: formatMoney(maxAmount, currency) })
                    : t('settle.pending_balance', { amount: formatMoney(maxAmount, currency) })
                  }
                </Text>
              </View>
            )}
          </View>

          {/* From → To */}
          <View style={[styles.transferCard, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
            <Pressable
              onPress={isPrefilled ? undefined : () => setShowFrom(true)}
              style={styles.transferSide}
            >
              <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase', marginBottom: 8 }]}>
                {t('settle.from_label')}
              </Text>
              {fromId ? (
                <View style={styles.transferUser}>
                  <Avatar name={getUserName(fromId)} hue={hueForUser(fromId)} size={36} />
                  <Text style={[Typography.bodyS, { color: c.text, fontWeight: '600', textAlign: 'center' }]} numberOfLines={2}>
                    {fromId === currentUser?.id ? t('common.you') : getUserName(fromId)}
                  </Text>
                </View>
              ) : (
                <Text style={[Typography.bodyM, { color: c.textTertiary }]}>{t('settle.select')}</Text>
              )}
            </Pressable>

            <View style={[styles.arrowBox, { backgroundColor: c.surfaceSunken }]}>
              <Ionicons name="arrow-forward" size={18} color={c.textSecondary} />
            </View>

            <Pressable
              onPress={isPrefilled ? undefined : () => setShowTo(true)}
              style={styles.transferSide}
            >
              <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase', marginBottom: 8 }]}>
                {t('settle.to_label')}
              </Text>
              {toId ? (
                <View style={styles.transferUser}>
                  <Avatar name={getUserName(toId)} hue={hueForUser(toId)} size={36} />
                  <Text style={[Typography.bodyS, { color: c.text, fontWeight: '600', textAlign: 'center' }]} numberOfLines={2}>
                    {getUserName(toId)}
                  </Text>
                </View>
              ) : (
                <Text style={[Typography.bodyM, { color: c.textTertiary }]}>{t('settle.select')}</Text>
              )}
            </Pressable>
          </View>

          {/* Group & date row */}
          <View style={styles.metaRow}>
            <Pressable
              onPress={() => { hapticSelection(); setShowGroup(true); }}
              style={[styles.metaChip, { backgroundColor: c.surface, borderColor: c.borderHair, flex: 1 }]}
            >
              <Ionicons name="people-outline" size={14} color={c.textSecondary} />
              <Text style={[Typography.bodyS, { color: c.text, fontWeight: '600', flex: 1 }]} numberOfLines={1}>
                {group?.name ?? t('expense.no_group_short')}
              </Text>
              <Ionicons name="chevron-down" size={14} color={c.textTertiary} />
            </Pressable>

            <Pressable
              onPress={() => { hapticSelection(); setShowDate(true); }}
              style={[styles.metaChip, { backgroundColor: c.surface, borderColor: c.borderHair }]}
            >
              <Ionicons name="calendar-outline" size={14} color={c.textSecondary} />
              <Text style={[Typography.bodyS, { color: c.text, fontWeight: '600' }]}>
                {formatDate(date)}
              </Text>
            </Pressable>
          </View>

          {/* Save */}
          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            style={[styles.saveBtn, { backgroundColor: canSave ? c.brand.primary : c.surfaceSunken }]}
          >
            <Text style={[Typography.bodyL, {
              color: canSave ? '#fff' : c.textDisabled, fontWeight: '700',
            }]}>
              {t('settle.title')}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Group picker */}
      <BottomSheet visible={showGroup} onClose={() => setShowGroup(false)}>
        <Text style={[Typography.h3, { color: c.text, marginBottom: 16 }]}>{t('expense.select_group')}</Text>
        {groups.map(g => (
          <SheetOption
            key={g.id}
            icon="people-outline"
            label={g.name}
            selected={g.id === groupId}
            onPress={() => handleGroupChange(g.id)}
          />
        ))}
      </BottomSheet>

      {/* From picker — only when not prefilled */}
      {!isPrefilled && (
        <BottomSheet visible={showFrom} onClose={() => setShowFrom(false)}>
          <Text style={[Typography.h3, { color: c.text, marginBottom: 16 }]}>{t('expense.who_paid')}</Text>
          {members.map(uid => (
            <SheetOptionAvatar
              key={uid}
              userId={uid}
              name={getUserName(uid)}
              selected={uid === fromId}
              onPress={() => handleFromChange(uid)}
            />
          ))}
        </BottomSheet>
      )}

      {/* To picker — only when not prefilled */}
      {!isPrefilled && (
        <BottomSheet visible={showTo} onClose={() => setShowTo(false)}>
          <Text style={[Typography.h3, { color: c.text, marginBottom: 16 }]}>{t('settle.who_received')}</Text>
          {toOptions.map(uid => (
            <SheetOptionAvatar
              key={uid}
              userId={uid}
              name={getUserName(uid)}
              selected={uid === toId}
              onPress={() => { hapticSelection(); setToId(uid); setShowTo(false); }}
            />
          ))}
        </BottomSheet>
      )}

      {/* Date picker */}
      <BottomSheet visible={showDate} onClose={() => setShowDate(false)}>
        <Text style={[Typography.h3, { color: c.text, marginBottom: 16 }]}>{t('settle.payment_date')}</Text>
        {Array.from({ length: 7 }, (_, i) => {
          const d = new Date();
          d.setDate(d.getDate() - i);
          d.setHours(12, 0, 0, 0);
          const label   = formatDate(d);
          const longFmt = i > 1
            ? d.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })
            : undefined;
          return (
            <SheetOption
              key={i}
              icon="calendar-outline"
              label={label}
              sublabel={longFmt}
              selected={formatDate(date) === label}
              onPress={() => { hapticSelection(); setDate(d); setShowDate(false); }}
            />
          );
        })}
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1 },
  header:         {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn:      { width: 40, alignItems: 'center' },
  scroll:         { paddingHorizontal: Spacing.screenPad, paddingTop: Spacing[4], gap: Spacing[3] },
  amountCard:     {
    borderRadius: Radius.lg, borderWidth: 1,
    paddingVertical: 20, alignItems: 'center', gap: 4,
  },
  amountRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  currencySymbol: { fontSize: 28, fontWeight: '400', lineHeight: 48, paddingBottom: 6 },
  maxHint:        {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: Radius.full, marginTop: 4,
  },
  transferCard:   {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: Radius.lg, borderWidth: 1,
    padding: Spacing[4],
  },
  transferSide:   { flex: 1, alignItems: 'center' },
  transferUser:   { alignItems: 'center', gap: 6, maxWidth: 90 },
  arrowBox:       {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 8,
  },
  metaRow:        { flexDirection: 'row', gap: 10 },
  metaChip:       {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: Radius.full, borderWidth: 1,
  },
  saveBtn:        { borderRadius: Radius.lg, paddingVertical: 16, alignItems: 'center' },
});
