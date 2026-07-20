import React, { useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { v4 as uuidv4 } from 'uuid';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAmountInput } from '@/src/hooks/useAmountInput';
import { useAuthStore } from '@/src/store/authStore';
import { usePersonalStore, toMonthKey } from '@/src/store/personalStore';
import { hapticSelection, hapticSuccess } from '@/src/utils/haptics';
import type { PersonalCategory, PersonalEntryKind } from '@/src/types/models';

type EntryTab = 'expense' | 'income';

interface CategoryMeta {
  key: PersonalCategory;
  label: string;
  icon: string;
}

const EXPENSE_CATEGORIES: CategoryMeta[] = [
  { key: 'food',          label: 'Comida',         icon: 'restaurant-outline' },
  { key: 'transport',     label: 'Transporte',     icon: 'car-outline' },
  { key: 'accommodation', label: 'Alojamiento',    icon: 'home-outline' },
  { key: 'entertainment', label: 'Ocio',           icon: 'musical-notes-outline' },
  { key: 'utilities',     label: 'Servicios',      icon: 'flash-outline' },
  { key: 'health',        label: 'Salud',          icon: 'heart-outline' },
  { key: 'shopping',      label: 'Compras',        icon: 'bag-outline' },
  { key: 'other',         label: 'Otro',           icon: 'ellipsis-horizontal-outline' },
];

const INCOME_CATEGORIES: CategoryMeta[] = [
  { key: 'salary',    label: 'Sueldo',    icon: 'briefcase-outline' },
  { key: 'freelance', label: 'Freelance', icon: 'laptop-outline' },
  { key: 'income',    label: 'Otro',      icon: 'cash-outline' },
];

function formatDateLabel(d: Date): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const dMid = new Date(d); dMid.setHours(0, 0, 0, 0);
  if (dMid.getTime() === today.getTime())     return 'Hoy';
  if (dMid.getTime() === yesterday.getTime()) return 'Ayer';
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

export default function PersonalNewScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { currentUser } = useAuthStore();
  const { addEntry, budget } = usePersonalStore();
  const { kind: paramKind } = useLocalSearchParams<{ kind?: string }>();

  const [tab,         setTab]         = useState<EntryTab>(paramKind === 'income' ? 'income' : 'expense');
  const [description, setDescription] = useState('');
  const [category,    setCategory]    = useState<PersonalCategory>('other');
  const [date,        setDate]        = useState(new Date());
  const [showDate,    setShowDate]    = useState(false);

  const currency = budget.currency as CurrencyCode;
  const {
    text: amountStr,
    minor: amount,
    onChangeText: setAmountStr,
    onBlur: onAmountBlur,
  } = useAmountInput(currency);
  const canSave  = description.trim().length > 0 && amount > 0;

  const categories = tab === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  function handleSave() {
    if (!canSave || !currentUser) return;
    hapticSuccess();
    const kind: PersonalEntryKind = tab === 'income' ? 'income' : 'expense';
    addEntry({
      id:          uuidv4(),
      kind,
      description: description.trim(),
      amount,
      currency,
      category:    category as PersonalCategory,
      date:        date.getTime(),
      createdAt:   Date.now(),
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
          <Text style={[Typography.h3, { color: c.text }]}>
            {tab === 'income' ? 'Agregar ingreso' : 'Agregar gasto'}
          </Text>
          <Pressable onPress={handleSave} disabled={!canSave} hitSlop={12} style={styles.headerBtn}>
            <Text style={[Typography.bodyM, {
              color: canSave ? c.brand.primary : c.textDisabled, fontWeight: '700', textAlign: 'right',
            }]}>
              Guardar
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* Tabs gasto / ingreso */}
          <View style={[styles.tabs, { backgroundColor: c.surfaceSunken }]}>
            {(['expense', 'income'] as EntryTab[]).map(t => (
              <Pressable
                key={t}
                onPress={() => { hapticSelection(); setTab(t); setCategory(t === 'income' ? 'salary' : 'other'); }}
                style={[styles.tabChip, t === tab && { backgroundColor: c.surface }]}
              >
                <Ionicons
                  name={t === 'income' ? 'trending-up-outline' : 'trending-down-outline'}
                  size={15}
                  color={t === tab ? (t === 'income' ? c.semantic.positive : c.semantic.negative) : c.textSecondary}
                />
                <Text style={[Typography.bodyS, {
                  color: t === tab ? c.text : c.textSecondary,
                  fontWeight: '600',
                }]}>
                  {t === 'income' ? 'Ingreso' : 'Gasto'}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Amount */}
          <View style={[styles.amountCard, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
            <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>
              {currency}
            </Text>
            <View style={styles.amountRow}>
              <Text style={[styles.currencySymbol, {
                color: tab === 'income' ? c.semantic.positive : c.semantic.negative,
              }]}>
                {tab === 'income' ? '+' : '-'}
              </Text>
              <TextInput
                value={amountStr}
                onChangeText={setAmountStr}
                onBlur={onAmountBlur}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={c.textTertiary}
                style={[Typography.amountXL, { color: c.text }]}
                returnKeyType="done"
                autoFocus
              />
            </View>
          </View>

          {/* Description */}
          <View style={[styles.inputCard, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
            <Ionicons name="pencil-outline" size={16} color={c.textTertiary} />
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder={tab === 'income' ? 'Descripción del ingreso' : 'Descripción del gasto'}
              placeholderTextColor={c.textTertiary}
              style={[Typography.bodyL, { flex: 1, color: c.text, padding: 0 }]}
              returnKeyType="done"
            />
          </View>

          {/* Category */}
          <Text style={[Typography.label, styles.sectionLabel, { color: c.textTertiary }]}>
            CATEGORÍA
          </Text>
          <View style={styles.categoryGrid}>
            {categories.map(cat => (
              <Pressable
                key={cat.key}
                onPress={() => { hapticSelection(); setCategory(cat.key); }}
                style={[
                  styles.categoryChip,
                  {
                    backgroundColor: category === cat.key ? c.brand.primary : c.surface,
                    borderColor:     category === cat.key ? c.brand.primary : c.borderHair,
                  },
                ]}
              >
                <Ionicons
                  name={cat.icon as any}
                  size={14}
                  color={category === cat.key ? '#fff' : c.textSecondary}
                />
                <Text style={[Typography.bodyS, {
                  color: category === cat.key ? '#fff' : c.text, fontWeight: '600',
                }]}>
                  {cat.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Date */}
          <Text style={[Typography.label, styles.sectionLabel, { color: c.textTertiary }]}>
            FECHA
          </Text>
          <Pressable
            onPress={() => { hapticSelection(); setShowDate(!showDate); }}
            style={[styles.inputCard, { backgroundColor: c.surface, borderColor: c.borderHair }]}
          >
            <Ionicons name="calendar-outline" size={16} color={c.textTertiary} />
            <Text style={[Typography.bodyL, { color: c.text }]}>
              {formatDateLabel(date)}
            </Text>
          </Pressable>

          {showDate && (
            <View style={[styles.datePicker, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
              {Array.from({ length: 7 }, (_, i) => {
                const d = new Date();
                d.setDate(d.getDate() - i);
                d.setHours(12, 0, 0, 0);
                const label = formatDateLabel(d);
                const isSel = toMonthKey(date.getTime()) === toMonthKey(d.getTime()) &&
                              date.getDate() === d.getDate();
                return (
                  <Pressable
                    key={i}
                    onPress={() => { hapticSelection(); setDate(d); setShowDate(false); }}
                    style={[styles.dateOption, isSel && { backgroundColor: c.brand.primarySoft }]}
                  >
                    <Text style={[Typography.bodyM, { color: isSel ? c.brand.primary : c.text, fontWeight: isSel ? '700' : '400' }]}>
                      {label}
                    </Text>
                    {i > 0 && (
                      <Text style={[Typography.caption, { color: c.textTertiary }]}>
                        {d.toLocaleDateString('es-AR', { weekday: 'long' })}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}

          <View style={{ height: Spacing[8] }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1 },
  header:        {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn:     { width: 56 },
  scroll:        { paddingHorizontal: Spacing.screenPad, paddingTop: Spacing[4] },
  tabs:          {
    flexDirection: 'row', borderRadius: Radius.md, padding: 4, gap: 4, marginBottom: Spacing[4],
  },
  tabChip:       {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9, borderRadius: Radius.sm,
  },
  amountCard:    {
    borderRadius: Radius.lg, borderWidth: 1,
    paddingVertical: 24, alignItems: 'center', gap: 4, marginBottom: Spacing[3],
  },
  amountRow:     { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  currencySymbol:{ fontSize: 32, fontWeight: '300', lineHeight: 52, paddingBottom: 4 },
  inputCard:     {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: Radius.lg, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 14, marginBottom: Spacing[3],
  },
  sectionLabel:  { marginBottom: Spacing[2] },
  categoryGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: Spacing[3] },
  categoryChip:  {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1,
  },
  datePicker:    { borderRadius: Radius.lg, borderWidth: 1, overflow: 'hidden', marginBottom: Spacing[3] },
  dateOption:    { paddingHorizontal: 16, paddingVertical: 12, gap: 2 },
});
