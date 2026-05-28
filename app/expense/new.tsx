import React, { useState, useMemo } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { v4 as uuidv4 } from 'uuid';
import { hapticSelection, hapticSuccess } from '@/src/utils/haptics';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useTierStore } from '@/src/store/tierStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePersonalStore, toMonthKey } from '@/src/store/personalStore';
import { hueForUser } from '@/src/utils/hueForUser';
import { Avatar } from '@/src/components/Avatar';
import { BottomSheet, SheetOption, SheetOptionAvatar } from '@/src/components/Sheet';
import type { ExpenseCategory } from '@/src/types/models';

const CATEGORIES: { id: ExpenseCategory; icon: React.ComponentProps<typeof Ionicons>['name']; label: string }[] = [
  { id: 'food',          icon: 'restaurant-outline',          label: 'Comida'        },
  { id: 'transport',     icon: 'car-outline',                 label: 'Transporte'    },
  { id: 'accommodation', icon: 'home-outline',                label: 'Alojamiento'   },
  { id: 'entertainment', icon: 'game-controller-outline',     label: 'Ocio'          },
  { id: 'utilities',     icon: 'flash-outline',               label: 'Servicios'     },
  { id: 'health',        icon: 'medical-outline',             label: 'Salud'         },
  { id: 'shopping',      icon: 'bag-outline',                 label: 'Compras'       },
  { id: 'other',         icon: 'ellipsis-horizontal-outline', label: 'Otro'          },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

type SplitMode  = 'equal' | 'percentage';
type PercentSub = 'same'  | 'custom';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatDate(d: Date): string {
  const today     = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const dMid      = new Date(d);    dMid.setHours(0, 0, 0, 0);
  if (dMid.getTime() === today.getTime())     return 'Hoy';
  if (dMid.getTime() === yesterday.getTime()) return 'Ayer';
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function NewExpenseScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { currentUser, isPro } = useAuthStore();
  const { requiresRewardedAd, getDailyCount, incrementCount } = useTierStore();
  const { addExpense, updateExpense } = useExpenseStore();
  const { addEntry: addPersonalEntry, updateReplicatedEntry } = usePersonalStore();
  const { getUserName } = useUserStore();
  const allGroups = useGroupStore(s => s.groups);
  const groups = useMemo(() => allGroups.filter(g => !g.isDeleted), [allGroups]);

  const { groupId: paramGroupId, expenseId } = useLocalSearchParams<{ groupId?: string; expenseId?: string }>();

  // In edit mode: load existing expense to pre-fill form
  const existingExpense = useExpenseStore(s =>
    expenseId ? s.expenses.find(e => e.id === expenseId) : undefined,
  );
  const isEditMode = Boolean(expenseId);

  // Pre-compute initial percentage state from existing expense splits (before useState)
  let initSplitMode: SplitMode = 'equal';
  let initPercentSub: PercentSub = 'same';
  let initSamePercent = '';
  let initCustomPercents: string[] = [];

  if (existingExpense && existingExpense.splitMode === 'percentage' && existingExpense.amount > 0) {
    initSplitMode = 'percentage';
    const { amount, splits } = existingExpense;
    const firstPct = round2((splits[0]?.amount / amount) * 100);
    const percents = splits.slice(0, -1).map(s => String(round2((s.amount / amount) * 100)));
    const allEqual = percents.every(p => parseFloat(p) === firstPct);
    initPercentSub    = allEqual ? 'same' : 'custom';
    initSamePercent   = String(firstPct);
    initCustomPercents = percents;
  }

  // ── Core inputs ────────────────────────────────────────────────────────────
  const [description,    setDescription]    = useState(existingExpense?.description ?? '');
  const [amountStr,      setAmountStr]      = useState(existingExpense ? String(existingExpense.amount) : '');
  const [groupId,        setGroupId]        = useState(
    existingExpense?.groupId ?? paramGroupId ?? groups[0]?.id ?? '',
  );
  const [payerId,        setPayerId]        = useState(
    existingExpense?.paidById ?? currentUser?.id ?? '',
  );
  const [date,           setDate]           = useState(
    existingExpense ? new Date(existingExpense.date) : new Date(),
  );
  const [note,           setNote]           = useState(existingExpense?.note ?? '');
  const [category,       setCategory]       = useState<ExpenseCategory>(existingExpense?.category ?? 'other');
  const [receiptUri,     setReceiptUri]     = useState<string | undefined>(existingExpense?.receiptImageUri);

  // ── Split ──────────────────────────────────────────────────────────────────
  const [splitMode,      setSplitMode]      = useState<SplitMode>(initSplitMode);
  const [percentSub,     setPercentSub]     = useState<PercentSub>(initPercentSub);
  const [samePercent,    setSamePercent]    = useState(initSamePercent);
  const [customPercents, setCustomPercents] = useState<string[]>(initCustomPercents);

  // ── Modals ─────────────────────────────────────────────────────────────────
  const [showGroup,  setShowGroup]  = useState(false);
  const [showPayer,  setShowPayer]  = useState(false);
  const [showDate,   setShowDate]   = useState(false);
  const [showNote,   setShowNote]   = useState(false);

  // ── Derived ────────────────────────────────────────────────────────────────
  const group    = groups.find(g => g.id === groupId);
  const members  = group?.memberIds ?? [];
  const currency: CurrencyCode = group?.currency ?? 'ARS';
  const amount   = parseFloat(amountStr.replace(',', '.')) || 0;
  const dailyCount = currentUser ? getDailyCount(currentUser.id) : 0;
  const needsAd    = !isEditMode && currentUser ? requiresRewardedAd(currentUser.id, isPro) : false;

  // ── Computed splits ────────────────────────────────────────────────────────
  const splits = useMemo(() => {
    if (members.length === 0) return [];

    if (splitMode === 'equal') {
      const each     = round2(amount / members.length);
      const sumFirst = each * (members.length - 1);
      return members.map((userId, i) => ({
        userId,
        amount:  i === members.length - 1 ? round2(amount - sumFirst) : each,
        percent: round2(100 / members.length),
        isLast:  i === members.length - 1,
      }));
    }

    // percentage mode
    const firstPercents = members.slice(0, -1).map((_, i) =>
      percentSub === 'same'
        ? parseFloat(samePercent.replace(',', '.')) || 0
        : parseFloat(customPercents[i]?.replace(',', '.') ?? '') || 0,
    );
    const sumFirst    = firstPercents.reduce((a, b) => a + b, 0);
    const lastPercent = round2(100 - sumFirst);

    return members.map((userId, i) => {
      const isLast = i === members.length - 1;
      const pct    = isLast ? lastPercent : (firstPercents[i] ?? 0);
      return { userId, amount: round2(amount * pct / 100), percent: pct, isLast };
    });
  }, [amount, members, splitMode, percentSub, samePercent, customPercents]);

  const lastPercent  = splits[splits.length - 1]?.percent ?? 0;
  const percentError = splitMode === 'percentage' && amount > 0 && lastPercent < 0;
  const canSave      = description.trim().length > 0 && amount > 0 && !percentError && members.length > 0;

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleSplitModeChange(mode: SplitMode) {
    setSplitMode(mode);
    if (mode === 'percentage' && members.length > 0) {
      const equal = Math.floor(100 / members.length);
      setSamePercent(String(equal));
      setCustomPercents(members.slice(0, -1).map(() => String(equal)));
    }
  }

  function handlePercentSubChange(sub: PercentSub) {
    setPercentSub(sub);
    if (members.length > 0) {
      const equal = Math.floor(100 / members.length);
      setSamePercent(String(equal));
      setCustomPercents(members.slice(0, -1).map(() => String(equal)));
    }
  }

  function handleGroupChange(id: string) {
    const newGroup   = groups.find(g => g.id === id);
    const newMembers = newGroup?.memberIds ?? [];
    setGroupId(id);
    setCustomPercents(newMembers.slice(0, -1).map(() => ''));
    setPayerId(
      currentUser && newMembers.includes(currentUser.id)
        ? currentUser.id
        : (newMembers[0] ?? ''),
    );
    setShowGroup(false);
  }

  function handleSave() {
    if (!canSave || !currentUser) return;
    if (needsAd) return;
    hapticSuccess(); // TODO: rewarded ad gate

    const splitPayload = splits.map(s => ({
      userId: s.userId,
      amount: s.amount,
      isPaid: s.userId === (payerId || currentUser.id),
    }));

    const myShare = splitPayload.find(s => s.userId === currentUser.id)?.amount ?? 0;
    const groupName = group?.name ?? '';

    if (isEditMode && expenseId) {
      updateExpense(expenseId, {
        description:     description.trim(),
        amount,
        paidById:        payerId || currentUser.id,
        splits:          splitPayload,
        splitMode,
        category,
        date:            date.getTime(),
        note:            note || undefined,
        receiptImageUri: receiptUri,
      });
      // Keep personal replica in sync with edited values
      if (myShare > 0) {
        updateReplicatedEntry(expenseId, {
          description:     description.trim(),
          amount:          myShare,
          category,
          date:            date.getTime(),
          sourceGroupName: groupName,
        });
      }
    } else {
      const newId = uuidv4();
      addExpense({
        id:              newId,
        groupId,
        description:     description.trim(),
        amount,
        currency,
        paidById:        payerId || currentUser.id,
        splits:          splitPayload,
        splitMode,
        category,
        date:            date.getTime(),
        createdAt:       Date.now(),
        createdById:     currentUser.id,
        note:            note || undefined,
        receiptImageUri: receiptUri,
        deletionVotes:   [],
        updatedAt:       Date.now(),
        isDeleted:       false,
      });
      // Replicate my share to personal expenses
      if (myShare > 0) {
        addPersonalEntry({
          id:                   uuidv4(),
          kind:                 'group_replicated',
          description:          description.trim(),
          amount:               myShare,
          currency,
          category,
          date:                 date.getTime(),
          createdAt:            Date.now(),
          updatedAt:            Date.now(),
          isDeleted:            false,
          sourceGroupExpenseId: newId,
          sourceGroupId:        groupId,
          sourceGroupName:      groupName,
        });
      }
      incrementCount(currentUser.id);
    }

    router.back();
  }

  async function handleCamera() {
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      setReceiptUri(result.assets[0].uri);
    }
  }

  async function handleFilePick() {
    const result = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'] });
    if (!result.canceled && result.assets[0]) {
      setReceiptUri(result.assets[0].uri);
    }
  }

  const groupName = group?.name ?? 'Sin grupo';
  const payerName = getUserName(payerId);

  // ── Guard: no groups ────────────────────────────────────────────────────────
  if (groups.length === 0) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
        <View style={[styles.header, { borderBottomColor: c.borderHair }]}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn}>
            <Ionicons name="close" size={24} color={c.text} />
          </Pressable>
          <Text style={[Typography.h3, { color: c.text }]}>Nuevo gasto</Text>
          <View style={styles.headerBtn} />
        </View>
        <View style={styles.noGroupsState}>
          <View style={[styles.noGroupsIcon, { backgroundColor: c.surfaceSunken }]}>
            <Ionicons name="people-outline" size={36} color={c.textTertiary} />
          </View>
          <Text style={[Typography.h3, { color: c.text, textAlign: 'center' }]}>
            Primero creá un grupo
          </Text>
          <Text style={[Typography.bodyM, { color: c.textTertiary, textAlign: 'center', lineHeight: 22 }]}>
            Para registrar un gasto necesitás al menos un grupo con participantes.
          </Text>
          <Pressable
            onPress={() => { router.back(); router.push('/groups/new' as any); }}
            style={[styles.saveBtn, { backgroundColor: c.brand.primary, paddingHorizontal: 32 }]}
          >
            <Text style={[Typography.bodyL, { color: '#fff', fontWeight: '700' }]}>
              Crear grupo
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        {/* Header */}
        <View style={[styles.header, { borderBottomColor: c.borderHair }]}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn}>
            <Ionicons name="close" size={24} color={c.text} />
          </Pressable>
          <Text style={[Typography.h3, { color: c.text }]}>
            {isEditMode ? 'Editar gasto' : 'Nuevo gasto'}
          </Text>
          <View style={styles.headerBtn} />
        </View>

        {/* Scrollable body */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Description input */}
          <View style={[styles.inputCard, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
            <Ionicons name="create-outline" size={18} color={c.textTertiary} style={{ marginTop: 1 }} />
            <TextInput
              placeholder="¿En qué gastaron?"
              placeholderTextColor={c.textTertiary}
              value={description}
              onChangeText={setDescription}
              style={[Typography.bodyL, styles.descInput, { color: c.text }]}
              returnKeyType="next"
            />
          </View>

          {/* Category chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryScroll}
          >
            {CATEGORIES.map(cat => {
              const active = category === cat.id;
              return (
                <Pressable
                  key={cat.id}
                  onPress={() => { hapticSelection(); setCategory(cat.id); }}
                  style={[
                    styles.categoryChip,
                    {
                      backgroundColor: active ? c.brand.primary : c.surface,
                      borderColor:     active ? c.brand.primary : c.borderHair,
                    },
                  ]}
                >
                  <Ionicons name={cat.icon} size={16} color={active ? '#fff' : c.textSecondary} />
                  <Text style={[Typography.bodyS, {
                    color:      active ? '#fff' : c.textSecondary,
                    fontWeight: active ? '700' : '500',
                  }]}>
                    {cat.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Amount input */}
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

          {/* Payer */}
          <Pressable
            onPress={() => setShowPayer(true)}
            style={[styles.row, { backgroundColor: c.surface, borderColor: c.borderHair }]}
          >
            <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>Pagó</Text>
            <View style={styles.rowRight}>
              <Avatar name={payerName} hue={hueForUser(payerId)} size={24} />
              <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]}>{payerName}</Text>
              <Ionicons name="chevron-down" size={16} color={c.textTertiary} />
            </View>
          </Pressable>

          {/* Split section */}
          <View style={styles.splitSection}>
            <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>
              Cómo se divide
            </Text>

            {/* Mode tabs */}
            <View style={[styles.segmented, { backgroundColor: c.surfaceSunken }]}>
              <SegTab
                label="Partes iguales"
                active={splitMode === 'equal'}
                onPress={() => handleSplitModeChange('equal')}
              />
              <SegTab
                label="Porcentaje"
                active={splitMode === 'percentage'}
                onPress={() => handleSplitModeChange('percentage')}
              />
            </View>

            {/* Percentage sub-mode */}
            {splitMode === 'percentage' && (
              <>
                <View style={[styles.subSegmented, { backgroundColor: c.surfaceSunken }]}>
                  <SegTab
                    label="Todos igual"
                    active={percentSub === 'same'}
                    onPress={() => handlePercentSubChange('same')}
                  />
                  <SegTab
                    label="Por persona"
                    active={percentSub === 'custom'}
                    onPress={() => handlePercentSubChange('custom')}
                  />
                </View>

                {percentSub === 'same' && (
                  <View style={styles.samePercentRow}>
                    <View style={[styles.samePercentBox, { backgroundColor: c.surfaceSunken, borderColor: c.border }]}>
                      <TextInput
                        value={samePercent}
                        onChangeText={setSamePercent}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={c.textTertiary}
                        style={[Typography.amountM, { color: c.text, minWidth: 50, textAlign: 'center' }]}
                      />
                      <Text style={[Typography.h3, { color: c.textSecondary }]}>%</Text>
                    </View>
                    <Text style={[Typography.bodyS, { color: c.textTertiary }]}>
                      para cada persona · el último recibe el resto
                    </Text>
                  </View>
                )}
              </>
            )}

            {/* Member rows */}
            <View style={styles.memberList}>
              {splits.map((split, i) => {
                const name    = getUserName(split.userId);
                const isLast  = split.isLast;
                const showRest = isLast && splitMode === 'percentage';

                return (
                  <View
                    key={split.userId}
                    style={[
                      styles.memberRow,
                      { backgroundColor: showRest ? c.brand.primarySoft : c.surfaceWarm },
                    ]}
                  >
                    <Avatar name={name} hue={hueForUser(split.userId)} size={32} />
                    <Text style={[Typography.bodyM, { flex: 1, color: c.text, fontWeight: '600' }]}>
                      {name}
                    </Text>

                    {splitMode === 'percentage' && percentSub === 'custom' && !isLast && (
                      <View style={styles.percentBox}>
                        <TextInput
                          value={customPercents[i] ?? ''}
                          onChangeText={v => {
                            const next = [...customPercents];
                            next[i] = v;
                            setCustomPercents(next);
                          }}
                          keyboardType="decimal-pad"
                          placeholder="0"
                          placeholderTextColor={c.textTertiary}
                          style={[Typography.amountS, { color: c.text, textAlign: 'right', minWidth: 44 }]}
                        />
                        <Text style={[Typography.bodyM, { color: c.textTertiary }]}>%</Text>
                      </View>
                    )}

                    {showRest ? (
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[Typography.caption, { color: c.brand.primaryOnSoft }]}>
                          {lastPercent < 0 ? '⚠ excedido' : `${round2(lastPercent)}% · resto`}
                        </Text>
                        <Text style={[Typography.amountS, {
                          color: lastPercent >= 0 ? c.brand.primaryOnSoft : c.semantic.negative,
                        }]}>
                          {formatMoney(Math.max(0, split.amount), currency)}
                        </Text>
                      </View>
                    ) : (
                      <View style={{ alignItems: 'flex-end' }}>
                        {splitMode === 'percentage' && percentSub === 'same' && (
                          <Text style={[Typography.caption, { color: c.textTertiary }]}>
                            {round2(parseFloat(samePercent) || 0)}%
                          </Text>
                        )}
                        <Text style={[Typography.amountS, { color: c.text }]}>
                          {formatMoney(split.amount, currency)}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })}

              {percentError && (
                <View style={[styles.errorRow, { backgroundColor: c.semantic.errorSoft }]}>
                  <Ionicons name="warning-outline" size={16} color={c.semantic.error} />
                  <Text style={[Typography.bodyS, { color: c.semantic.error, flex: 1 }]}>
                    Los porcentajes superan el 100%.
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Free tier notice — only shown when creating */}
          {!isEditMode && !isPro && (
            <View style={[styles.tierRow, { backgroundColor: c.semantic.warningSoft }]}>
              <Ionicons name="information-circle-outline" size={16} color={c.semantic.warning} />
              <Text style={[Typography.bodyS, { color: '#8A6420', flex: 1 }]}>
                {dailyCount} de 4 gastos gratis hoy.{' '}
                {needsAd ? 'El próximo requiere ver un anuncio o activar Pro.' : ''}
              </Text>
            </View>
          )}

          {/* Save button */}
          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            style={[styles.saveBtn, { backgroundColor: canSave ? c.brand.primary : c.surfaceSunken }]}
          >
            <Text style={[Typography.bodyL, { color: canSave ? '#fff' : c.textDisabled, fontWeight: '700' }]}>
              {!isEditMode && needsAd ? 'Ver anuncio y guardar' : 'Guardar'}
            </Text>
          </Pressable>

          <View style={{ height: Spacing[4] }} />
        </ScrollView>

        {/* Bottom bar */}
        <View style={[styles.bottomBar, { backgroundColor: c.surface, borderTopColor: c.borderHair }]}>
          {/* Left: attachments */}
          <View style={styles.bottomLeft}>
            <Pressable onPress={handleCamera} hitSlop={10}>
              <Ionicons
                name={receiptUri ? 'camera' : 'camera-outline'}
                size={22}
                color={receiptUri ? c.brand.primary : c.textSecondary}
              />
            </Pressable>
            <Pressable onPress={handleFilePick} hitSlop={10}>
              <Ionicons name="attach-outline" size={22} color={c.textSecondary} />
            </Pressable>
            <Pressable onPress={() => setShowNote(true)} hitSlop={10}>
              <Ionicons
                name={note ? 'document-text' : 'document-text-outline'}
                size={22}
                color={note ? c.brand.primary : c.textSecondary}
              />
            </Pressable>
          </View>

          <View style={[styles.vDivider, { backgroundColor: c.border }]} />

          {/* Center: group — locked in edit mode */}
          <Pressable
            onPress={isEditMode ? undefined : () => setShowGroup(true)}
            style={styles.bottomGroup}
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

          <View style={[styles.vDivider, { backgroundColor: c.border }]} />

          {/* Right: date */}
          <Pressable onPress={() => setShowDate(true)} style={styles.bottomDate}>
            <Ionicons name="calendar-outline" size={16} color={c.textSecondary} />
            <Text style={[Typography.bodyS, { color: c.text, fontWeight: '600' }]}>
              {formatDate(date)}
            </Text>
          </Pressable>
        </View>

      </KeyboardAvoidingView>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {/* Group picker — only shown in create mode */}
      {!isEditMode && (
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
      )}

      {/* Payer picker */}
      <BottomSheet visible={showPayer} onClose={() => setShowPayer(false)}>
        <Text style={[Typography.h3, { color: c.text, marginBottom: 16 }]}>¿Quién pagó?</Text>
        {members.map(userId => (
          <SheetOptionAvatar
            key={userId}
            userId={userId}
            name={getUserName(userId)}
            selected={userId === payerId}
            onPress={() => { setPayerId(userId); setShowPayer(false); }}
          />
        ))}
      </BottomSheet>

      {/* Date picker */}
      <BottomSheet visible={showDate} onClose={() => setShowDate(false)}>
        <Text style={[Typography.h3, { color: c.text, marginBottom: 16 }]}>Fecha del gasto</Text>
        {Array.from({ length: 7 }, (_, i) => {
          const d = new Date();
          d.setDate(d.getDate() - i);
          d.setHours(12, 0, 0, 0);
          const label   = formatDate(d);
          const longFmt = i > 1 ? d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }) : undefined;
          const isSel   = formatDate(date) === label;
          return (
            <SheetOption
              key={i}
              icon="calendar-outline"
              label={label}
              sublabel={longFmt}
              selected={isSel}
              onPress={() => { setDate(d); setShowDate(false); }}
            />
          );
        })}
      </BottomSheet>

      {/* Note */}
      <BottomSheet visible={showNote} onClose={() => setShowNote(false)}>
        <Text style={[Typography.h3, { color: c.text, marginBottom: 12 }]}>Nota</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Agregar nota opcional..."
          placeholderTextColor={c.textTertiary}
          multiline
          numberOfLines={4}
          style={[
            Typography.bodyM,
            styles.noteInput,
            { color: c.text, backgroundColor: c.surfaceSunken },
          ]}
        />
        <Pressable
          onPress={() => setShowNote(false)}
          style={[styles.saveBtn, { backgroundColor: c.brand.primary, marginTop: 12 }]}
        >
          <Text style={[Typography.bodyL, { color: '#fff', fontWeight: '700' }]}>Listo</Text>
        </Pressable>
      </BottomSheet>

    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SegTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <Pressable
      onPress={onPress}
      style={[styles.segTab, active && { backgroundColor: c.surface }]}
    >
      <Text style={[Typography.bodyS, { fontWeight: '600', color: active ? c.text : c.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:         { flex: 1 },
  header:       {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn:    { width: 28, alignItems: 'center' },
  scroll:       { paddingHorizontal: Spacing.screenPad, paddingTop: Spacing[4], gap: Spacing[3] },

  noGroupsState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing[8], gap: Spacing[4],
  },
  noGroupsIcon:  {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing[2],
  },

  categoryScroll: { gap: 8, paddingVertical: 2 },
  categoryChip:   {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: Radius.full, borderWidth: 1,
  },

  inputCard:    {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: Radius.lg, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  descInput:    { flex: 1, padding: 0, fontWeight: '500' },
  amountCard:   {
    borderRadius: Radius.lg, borderWidth: 1,
    paddingVertical: 20, alignItems: 'center', gap: 4,
  },
  amountRow:    { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  currencySymbol: { fontSize: 28, fontWeight: '400', lineHeight: 48, paddingBottom: 6, color: '#8B8275' },

  row:          {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: Radius.lg, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 13,
  },
  rowRight:     { flexDirection: 'row', alignItems: 'center', gap: 8 },

  splitSection: { gap: Spacing[2] },
  segmented:    { flexDirection: 'row', padding: 3, borderRadius: Radius.md, gap: 2 },
  subSegmented: { flexDirection: 'row', padding: 3, borderRadius: Radius.md, gap: 2 },
  segTab:       { flex: 1, paddingVertical: 8, borderRadius: Radius.sm, alignItems: 'center' },
  samePercentRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4 },
  samePercentBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: Radius.lg, borderWidth: 1,
  },
  memberList:   { gap: 6 },
  memberRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: Radius.md },
  percentBox:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  errorRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: Radius.md },
  tierRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: Radius.md },

  saveBtn:      { borderRadius: Radius.lg, paddingVertical: 16, alignItems: 'center' },

  bottomBar:    {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, height: 52,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bottomLeft:   { flexDirection: 'row', alignItems: 'center', gap: 18, paddingHorizontal: 6 },
  vDivider:     { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: 10 },
  bottomGroup:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6 },
  bottomDate:   { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6 },

  noteInput:    {
    borderRadius: Radius.md, padding: 14,
    minHeight: 100, textAlignVertical: 'top',
  },
});
