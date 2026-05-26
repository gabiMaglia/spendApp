import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { v4 as uuidv4 } from 'uuid';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { hueForUser } from '@/src/utils/hueForUser';
import { Avatar } from '@/src/components/Avatar';
import { BottomSheet, SheetOption, SheetOptionAvatar } from '@/src/components/Sheet';

function formatDate(d: Date): string {
  const today     = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const dMid      = new Date(d);    dMid.setHours(0, 0, 0, 0);
  if (dMid.getTime() === today.getTime())     return 'Hoy';
  if (dMid.getTime() === yesterday.getTime()) return 'Ayer';
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

export default function SettleNewScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { currentUser } = useAuthStore();
  const { addPayment } = usePaymentStore();
  const { getUserName } = useUserStore();
  const allGroups = useGroupStore(s => s.groups);
  const groups = useMemo(() => allGroups.filter(g => !g.isDeleted), [allGroups]);

  const initialGroup = groups[0];
  const initialFromId = currentUser && initialGroup?.memberIds.includes(currentUser.id)
    ? currentUser.id
    : (initialGroup?.memberIds[0] ?? '');
  const initialToId = initialGroup?.memberIds.filter(uid => uid !== initialFromId)[0] ?? '';

  const [groupId,   setGroupId]   = useState(initialGroup?.id ?? '');
  const [fromId,    setFromId]    = useState(initialFromId);
  const [toId,      setToId]      = useState(initialToId);
  const [amountStr, setAmountStr] = useState('');
  const [date,      setDate]      = useState(new Date());

  const [showGroup, setShowGroup] = useState(false);
  const [showFrom,  setShowFrom]  = useState(false);
  const [showTo,    setShowTo]    = useState(false);
  const [showDate,  setShowDate]  = useState(false);

  const group    = groups.find(g => g.id === groupId);
  const members  = group?.memberIds ?? [];
  const currency = group?.currency ?? 'ARS';
  const amount   = parseFloat(amountStr.replace(',', '.')) || 0;
  const toOptions = members.filter(uid => uid !== fromId);
  const canSave   = amount > 0 && fromId.length > 0 && toId.length > 0 && fromId !== toId && groupId.length > 0;

  function handleGroupChange(id: string) {
    const g = groups.find(x => x.id === id);
    const mems = g?.memberIds ?? [];
    setGroupId(id);
    const newFrom = currentUser && mems.includes(currentUser.id) ? currentUser.id : (mems[0] ?? '');
    const newTo   = mems.filter(uid => uid !== newFrom)[0] ?? '';
    setFromId(newFrom);
    setToId(newTo);
    setShowGroup(false);
  }

  function handleFromChange(id: string) {
    setFromId(id);
    if (toId === id) setToId(members.filter(uid => uid !== id)[0] ?? '');
    setShowFrom(false);
  }

  function handleSave() {
    if (!canSave || !currentUser) return;
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
          <Text style={[Typography.h3, { color: c.text }]}>Registrar pago</Text>
          <View style={styles.headerBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* Amount */}
          <View style={[styles.amountCard, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
            <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>
              {currency}
            </Text>
            <View style={styles.amountRow}>
              <Text style={[styles.currencySymbol, { color: c.textTertiary }]}>$</Text>
              <TextInput
                value={amountStr}
                onChangeText={setAmountStr}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={c.textTertiary}
                style={[Typography.amountXL, { color: c.text }]}
                returnKeyType="done"
              />
            </View>
          </View>

          {/* From → To */}
          <View style={[styles.transferCard, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
            <Pressable onPress={() => setShowFrom(true)} style={styles.transferSide}>
              <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase', marginBottom: 8 }]}>
                De
              </Text>
              {fromId ? (
                <View style={styles.transferUser}>
                  <Avatar name={getUserName(fromId)} hue={hueForUser(fromId)} size={36} />
                  <Text style={[Typography.bodyS, { color: c.text, fontWeight: '600', textAlign: 'center' }]} numberOfLines={2}>
                    {getUserName(fromId)}
                  </Text>
                </View>
              ) : (
                <Text style={[Typography.bodyM, { color: c.textTertiary }]}>Seleccionar</Text>
              )}
            </Pressable>

            <View style={[styles.arrowBox, { backgroundColor: c.surfaceSunken }]}>
              <Ionicons name="arrow-forward" size={18} color={c.textSecondary} />
            </View>

            <Pressable onPress={() => setShowTo(true)} style={styles.transferSide}>
              <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase', marginBottom: 8 }]}>
                A
              </Text>
              {toId ? (
                <View style={styles.transferUser}>
                  <Avatar name={getUserName(toId)} hue={hueForUser(toId)} size={36} />
                  <Text style={[Typography.bodyS, { color: c.text, fontWeight: '600', textAlign: 'center' }]} numberOfLines={2}>
                    {getUserName(toId)}
                  </Text>
                </View>
              ) : (
                <Text style={[Typography.bodyM, { color: c.textTertiary }]}>Seleccionar</Text>
              )}
            </Pressable>
          </View>

          {/* Group & date row */}
          <View style={styles.metaRow}>
            <Pressable
              onPress={() => setShowGroup(true)}
              style={[styles.metaChip, { backgroundColor: c.surface, borderColor: c.borderHair, flex: 1 }]}
            >
              <Ionicons name="people-outline" size={14} color={c.textSecondary} />
              <Text style={[Typography.bodyS, { color: c.text, fontWeight: '600', flex: 1 }]} numberOfLines={1}>
                {group?.name ?? 'Sin grupo'}
              </Text>
              <Ionicons name="chevron-down" size={14} color={c.textTertiary} />
            </Pressable>

            <Pressable
              onPress={() => setShowDate(true)}
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
              Registrar pago
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Group picker */}
      <BottomSheet visible={showGroup} onClose={() => setShowGroup(false)}>
        <Text style={[Typography.h3, { color: c.text, marginBottom: 16 }]}>Seleccionar grupo</Text>
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

      {/* From picker */}
      <BottomSheet visible={showFrom} onClose={() => setShowFrom(false)}>
        <Text style={[Typography.h3, { color: c.text, marginBottom: 16 }]}>¿Quién pagó?</Text>
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

      {/* To picker */}
      <BottomSheet visible={showTo} onClose={() => setShowTo(false)}>
        <Text style={[Typography.h3, { color: c.text, marginBottom: 16 }]}>¿A quién le pagó?</Text>
        {toOptions.map(uid => (
          <SheetOptionAvatar
            key={uid}
            userId={uid}
            name={getUserName(uid)}
            selected={uid === toId}
            onPress={() => { setToId(uid); setShowTo(false); }}
          />
        ))}
      </BottomSheet>

      {/* Date picker */}
      <BottomSheet visible={showDate} onClose={() => setShowDate(false)}>
        <Text style={[Typography.h3, { color: c.text, marginBottom: 16 }]}>Fecha del pago</Text>
        {Array.from({ length: 7 }, (_, i) => {
          const d = new Date();
          d.setDate(d.getDate() - i);
          d.setHours(12, 0, 0, 0);
          const label   = formatDate(d);
          const longFmt = i > 1
            ? d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
            : undefined;
          return (
            <SheetOption
              key={i}
              icon="calendar-outline"
              label={label}
              sublabel={longFmt}
              selected={formatDate(date) === label}
              onPress={() => { setDate(d); setShowDate(false); }}
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
