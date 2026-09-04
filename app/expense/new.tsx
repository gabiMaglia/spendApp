import React, { useState, useMemo } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { v4 as uuidv4 } from 'uuid';
import { hapticSelection, hapticSuccess } from '@/src/utils/haptics';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { RecurrencePicker, type RecurrenceValue } from '@/src/components/RecurrencePicker';
import { PayerSplitter } from '@/src/components/PayerSplitter';
import { normalizePayers, validatePayers } from '@/src/algorithms/payers';
import type { Payer } from '@/src/types/models';
import { useRecurringStore } from '@/src/store/recurringStore';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAmountInput } from '@/src/hooks/useAmountInput';
import { useAuthStore } from '@/src/store/authStore';
import { ADS_DISPONIBLES, useTierStore } from '@/src/store/tierStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePersonalStore, toMonthKey } from '@/src/store/personalStore';
import { UserAvatar } from '@/src/components/UserAvatar';
import { BottomSheet, SheetButton, SheetInput, SheetOption, SheetOptionAvatar } from '@/src/components/Sheet';
import { Band, SectionLabel, Segmented } from '@/src/components/Band';
import { DetailHeader } from '@/src/components/CollapsibleHeader';
import { buildSplits } from '@/src/algorithms/buildSplits';
import type { ExpenseCategory, PersonalCategory } from '@/src/types/models';
import { syncedNow } from '@/src/utils/syncedClock';

type CatMeta = { id: PersonalCategory; icon: React.ComponentProps<typeof Ionicons>['name']; label: string };

const CATEGORIES: CatMeta[] = [
  { id: 'food',          icon: 'restaurant-outline',          label: 'Comida'        },
  { id: 'transport',     icon: 'car-outline',                 label: 'Transporte'    },
  { id: 'accommodation', icon: 'home-outline',                label: 'Alojamiento'   },
  { id: 'entertainment', icon: 'game-controller-outline',     label: 'Ocio'          },
  { id: 'utilities',     icon: 'flash-outline',               label: 'Servicios'     },
  { id: 'health',        icon: 'medical-outline',             label: 'Salud'         },
  { id: 'shopping',      icon: 'bag-outline',                 label: 'Compras'       },
  { id: 'other',         icon: 'ellipsis-horizontal-outline', label: 'Otro'          },
];

// Categorías de ingreso — solo disponibles en modo Personal (F-G2).
const INCOME_CATEGORIES: CatMeta[] = [
  { id: 'salary',    icon: 'briefcase-outline', label: 'Sueldo'    },
  { id: 'freelance', icon: 'laptop-outline',    label: 'Freelance' },
  { id: 'income',    icon: 'cash-outline',      label: 'Otro'      },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

type SplitMode  = 'equal' | 'percentage';
type PercentSub = 'same'  | 'custom';

// Redondeo de PORCENTAJES para mostrar en UI (no es un monto — ADR-002 no
// aplica acá; los splits reales se calculan en enteros vía buildSplits).
function roundPct(n: number): number {
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
  const { t } = useTranslation();
  const c = Colors[scheme];

  const { currentUser, isPro } = useAuthStore();
  const { requiresRewardedAd, superoElTope, getDailyCount, incrementCount } = useTierStore();
  const { addExpense, updateExpense } = useExpenseStore();
  const { addEntry: addPersonalEntry, updateReplicatedEntry } = usePersonalStore();
  const { getUserName } = useUserStore();
  const allGroups = useGroupStore(s => s.groups);
  const groups = useMemo(() => allGroups.filter(g => !g.isDeleted), [allGroups]);

  const { groupId: paramGroupId, expenseId, allowIncome, kind: paramKind } =
    useLocalSearchParams<{ groupId?: string; expenseId?: string; allowIncome?: string; kind?: string }>();

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
    const firstPct = roundPct((splits[0]?.amount / amount) * 100);
    const percents = splits.slice(0, -1).map(s => String(roundPct((s.amount / amount) * 100)));
    const allEqual = percents.every(p => parseFloat(p) === firstPct);
    initPercentSub    = allEqual ? 'same' : 'custom';
    initSamePercent   = String(firstPct);
    initCustomPercents = percents;
  }

  // ── Core inputs ────────────────────────────────────────────────────────────
  const [description,    setDescription]    = useState(existingExpense?.description ?? '');
  // Default: SIN grupo (gasto personal). Si viene por deep-link de un grupo
  // (paramGroupId) o en edición, se pre-selecciona ese grupo. (F-G, decisión PO)
  const [groupId,        setGroupId]        = useState(
    existingExpense?.groupId ?? paramGroupId ?? '',
  );
  // Moneda del grupo activo, resuelta temprano — el input de monto (entero,
  // menor unidad — ADR-002) la necesita para parsear/formatear correctamente.
  const currencyForAmount: CurrencyCode =
    groups.find(g => g.id === groupId)?.currency ?? 'ARS';
  const {
    text: amountStr,
    minor: amount,
    onChangeText: setAmountStr,
    onBlur: onAmountBlur,
    setMinor: setAmountMinor,
  } = useAmountInput(currencyForAmount, existingExpense?.amount ?? 0);
  const [payerId,        setPayerId]        = useState(
    existingExpense?.paidById ?? currentUser?.id ?? '',
  );
  const [date,           setDate]           = useState(
    existingExpense ? new Date(existingExpense.date) : new Date(),
  );
  const [note,           setNote]           = useState(existingExpense?.note ?? '');
  const [category,       setCategory]       = useState<PersonalCategory>(existingExpense?.category ?? 'other');
  // Modo Ingreso: SOLO habilitado cuando se abre desde Personal (allowIncome=1). (F-G2)
  const incomeAllowed = allowIncome === '1' && !isEditMode;
  const [entryKind, setEntryKind] = useState<'expense' | 'income'>(
    incomeAllowed && paramKind === 'income' ? 'income' : 'expense',
  );
  const isIncome = incomeAllowed && entryKind === 'income';
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
  const [recurrence, setRecurrence] = useState<RecurrenceValue>(null);
  const [multiPayer, setMultiPayer] = useState(false);
  const [payers, setPayers] = useState<Payer[]>([]);
  const addRecurring = useRecurringStore(st => st.addRecurring);

  // ── Derived ────────────────────────────────────────────────────────────────
  const group    = groups.find(g => g.id === groupId);
  const members  = group?.memberIds ?? [];
  const currency: CurrencyCode = currencyForAmount;
  const dailyCount = currentUser ? getDailyCount(currentUser.id) : 0;
  // Dos cosas distintas, y confundirlas era el bug: `superoElTope` es la REGLA
  // (pasaste los 4 del día) y sirve para contárselo al usuario; `needsAd` es si
  // hay que mostrarle un anuncio ANTES de guardar, que hoy es siempre false
  // porque no existe el sistema de anuncios. Ver `ADS_DISPONIBLES`.
  const pasoElTope = !isEditMode && currentUser ? superoElTope(currentUser.id, isPro) : false;
  const needsAd    = !isEditMode && currentUser ? requiresRewardedAd(currentUser.id, isPro) : false;

  // ── Computed splits ────────────────────────────────────────────────────────
  // Todos los montos de `splits` son ENTEROS en menor unidad (ADR-002),
  // calculados vía `buildSplits` — única fuente de verdad del reparto, para
  // que Σ splits === total EXACTO y sea reproducible entre dispositivos.
  const splits = useMemo(() => {
    if (members.length === 0) return [];

    if (splitMode === 'equal') {
      const built = buildSplits(amount, members, 'equal');
      const evenPercent = roundPct(100 / members.length);
      return built.map((s, i) => ({
        ...s,
        percent: evenPercent,
        isLast: i === built.length - 1,
      }));
    }

    // percentage mode — el usuario tipea el % de todos menos el último, que
    // recibe el resto (100 - Σ). Los montos de los "no-últimos" se redondean
    // desde su %; el último se calcula con buildSplits('custom') para que
    // cierre EXACTO contra el total (nunca deriva por acumulación de redondeo).
    const firstPercents = members.slice(0, -1).map((_, i) =>
      percentSub === 'same'
        ? parseFloat(samePercent.replace(',', '.')) || 0
        : parseFloat(customPercents[i]?.replace(',', '.') ?? '') || 0,
    );
    const sumFirst    = firstPercents.reduce((a, b) => a + b, 0);
    const lastPercent = roundPct(100 - sumFirst);
    const firstAmounts = firstPercents.map(pct => Math.round(amount * pct / 100));

    const built = buildSplits(amount, members, 'custom', firstAmounts);
    return built.map((s, i) => {
      const isLast = i === built.length - 1;
      return { ...s, percent: isLast ? lastPercent : (firstPercents[i] ?? 0), isLast };
    });
  }, [amount, members, splitMode, percentSub, samePercent, customPercents]);

  const lastPercent  = splits[splits.length - 1]?.percent ?? 0;
  const percentError = splitMode === 'percentage' && amount > 0 && lastPercent < 0;
  // hasGroup=false ⇒ gasto PERSONAL (sin repartos, sin pagador). (F-G)
  const hasGroup     = groupId !== '';
  // Con varios pagadores la suma tiene que dar EXACTA contra el total: son
  // enteros en menor unidad (ADR-002), no hay redondeo que perdonar.
  const payersOk     = !multiPayer || validatePayers(payers.filter(p => p.amount > 0), amount).ok;
  const canSave      = description.trim().length > 0 && amount > 0 && !percentError && (!hasGroup || members.length > 0) && payersOk;

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
    // Re-normaliza el texto del input a las reglas de decimales de la nueva
    // moneda (p.ej. si el nuevo grupo es CLP/PYG, sin decimales).
    setAmountMinor(amount);
    setShowGroup(false);
  }

  function switchEntryKind(k: 'expense' | 'income') {
    hapticSelection();
    setEntryKind(k);
    setCategory(k === 'income' ? 'income' : 'other');
    if (k === 'income') setGroupId(''); // el ingreso no lleva grupo
  }

  /**
   * Si el usuario eligió repetición, además del gasto de hoy se guarda la
   * PLANTILLA. `lastMaterializedAt` arranca en la fecha de este gasto para que
   * el materializador no vuelva a crear el que se acaba de crear a mano.
   */
  function saveRecurringTemplate() {
    if (recurrence === null || !currentUser) return;
    const at = date.getTime();
    addRecurring({
      id:          uuidv4(),
      groupId:     hasGroup ? groupId : '',
      description: description.trim(),
      amount,
      currency,
      ...payerFields(),
      splitMode,
      memberIds:   splits.map(sp => sp.userId),
      category:    category as ExpenseCategory,
      rule:        { frequency: recurrence, startDate: at },
      lastMaterializedAt: at,
      isActive:    true,
      createdAt:   Date.now(),
      createdById: currentUser.id,
      updatedAt:   syncedNow(),
      isDeleted:   false,
    });
  }

  /** Desglose de pagadores listo para guardar (o el pagador único). */
  function payerFields(): { paidById: string; payers: Payer[] | undefined } {
    // `payers: undefined` explícito, no ausente: se aplica con spread al editar,
    // y una clave ausente dejaría vivo el desglose anterior.
    if (!multiPayer) return { paidById: payerId || currentUser!.id, payers: undefined };
    return normalizePayers(payers);
  }

  function handleSave() {
    if (!canSave || !currentUser) return;

    // Sin grupo → entrada PERSONAL (gasto o ingreso). Sin ad gate/splits/pagador. (F-G/F-G2)
    if (!hasGroup) {
      hapticSuccess();
      addPersonalEntry({
        id:          uuidv4(),
        kind:        isIncome ? 'income' : 'expense',
        description: description.trim(),
        amount,
        currency,
        category,
        date:        date.getTime(),
        createdAt:   Date.now(),
        updatedAt:   syncedNow(),
        isDeleted:   false,
      });
      saveRecurringTemplate();
      router.back();
      return;
    }

    // Cuando exista el anuncio, acá va: mostrarlo y guardar recién al terminar.
    // Hasta entonces `needsAd` es siempre false — un `return` seco dejaba el
    // botón muerto y la app sin poder guardar gastos, en silencio.
    if (needsAd) return;
    hapticSuccess();

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
        ...payerFields(),
        splits:          splitPayload,
        splitMode,
        category:        category as ExpenseCategory,
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
        ...payerFields(),
        splits:          splitPayload,
        splitMode,
        category:        category as ExpenseCategory,
        date:            date.getTime(),
        createdAt:       Date.now(),
        createdById:     currentUser.id,
        note:            note || undefined,
        receiptImageUri: receiptUri,
        deletionVotes:   [],
        updatedAt:       syncedNow(),
        isDeleted:       false,
      });
      // ADR-006: se replica lo que SALIÓ DE MI BOLSILLO, no mi porción.
      // Si pagó otro, todavía no gasté nada — es una deuda, y se vuelve gasto
      // recién cuando la salde. Antes se replicaba `myShare` siempre, que
      // estaba mal en los dos sentidos: de menos si pagaba yo, y de más si
      // pagaba otro.
      if (payerFields().paidById === currentUser.id) {
        addPersonalEntry({
          id:                   uuidv4(),
          kind:                 'group_replicated',
          description:          description.trim(),
          amount,
          currency,
          category,
          date:                 date.getTime(),
          createdAt:            Date.now(),
          updatedAt:            syncedNow(),
          isDeleted:            false,
          sourceGroupExpenseId: newId,
          sourceGroupId:        groupId,
          sourceGroupName:      groupName,
        });
      }
      incrementCount(currentUser.id);
      saveRecurringTemplate();
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

  const groupName = group?.name ?? t('expense.no_group_short');
  const payerName = getUserName(payerId);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        <DetailHeader
          icon="close"
          title={isEditMode ? t('expense.edit_title') : isIncome ? t('expense.new_income_title') : t('expense.new_title')}
          onBack={() => router.back()}
        />

        {/* Scrollable body */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Toggle Gasto/Ingreso — solo en modo Personal (F-G2) */}
          {incomeAllowed && (
            <View style={styles.segPad}>
              <Segmented
                value={isIncome ? 'income' : 'expense'}
                onChange={switchEntryKind}
                options={[
                  { key: 'expense', label: t('expense.kind_expense') },
                  { key: 'income',  label: t('expense.kind_income') },
                ]}
              />
            </View>
          )}

          {/* Description input */}
          <Band>
            <View style={styles.inputRow}>
            <Ionicons name="create-outline" size={18} color={c.textTertiary} style={{ marginTop: 1 }} />
            <TextInput
              placeholder={isIncome ? t('expense.income_desc_placeholder') : t('expense.description_placeholder')}
              placeholderTextColor={c.textTertiary}
              value={description}
              onChangeText={setDescription}
              style={[Typography.bodyL, styles.descInput, { color: c.text }]}
              returnKeyType="next"
            />
            </View>
          </Band>

          {/* Category chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            // `flexGrow: 0` no es decorativo: el contenedor de la pantalla crece
            // para poder empujar Guardar al fondo, y un ScrollView horizontal sin
            // alto propio se come todo ese sobrante. Las pastillas quedaban
            // gigantes.
            style={styles.categoryScrollBox}
            contentContainerStyle={styles.categoryScroll}
          >
            {(isIncome ? INCOME_CATEGORIES : CATEGORIES).map(cat => {
              const active = category === cat.id;
              return (
                <Pressable
                  key={cat.id}
                  onPress={() => { hapticSelection(); setCategory(cat.id); }}
                  style={[
                    styles.categoryChip,
                    {
                      backgroundColor: active ? c.brand.primary : c.surface,
                      borderColor:     active ? c.brand.primary : c.hair,
                    },
                  ]}
                >
                  <Ionicons name={cat.icon} size={16} color={active ? '#fff' : c.textSecondary} />
                  <Text style={[Typography.bodyS, {
                    color:      active ? '#fff' : c.textSecondary,
                    fontWeight: active ? '700' : '500',
                  }]}>
                    {t(`categories.${cat.id}`)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Amount input */}
          <Band>
            <View style={styles.amountPad}>
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
                style={[Typography.amountXL, { color: c.text }]}
                returnKeyType="done"
              />
            </View>
            </View>
          </Band>

          {/* Payer + repartos: SOLO con grupo. Sin grupo = gasto personal. (F-G) */}
          {hasGroup && (<>
          {/* Payer */}
          {multiPayer ? (
            <Band>
            <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch', gap: Spacing[2] }]}>
              <PayerSplitter
                members={members.map(uid => ({ id: uid, name: getUserName(uid) }))}
                value={payers}
                totalAmount={amount}
                currency={currency}
                onChange={setPayers}
              />
              <Pressable onPress={() => { setMultiPayer(false); setPayers([]); }} hitSlop={8}>
                <Text style={[Typography.bodyS, { color: c.brand.primary }]}>{t('payers.single')}</Text>
              </Pressable>
            </View>
            </Band>
          ) : (
            <Band>
            <Pressable
              onPress={() => setShowPayer(true)}
              style={styles.row}
            >
              <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>{t('expense.payer_label')}</Text>
              <View style={styles.rowRight}>
                <UserAvatar userId={payerId} name={payerName} size={24} />
                <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]}>{payerName}</Text>
                <Ionicons name="chevron-down" size={16} color={c.textTertiary} />
              </View>
            </Pressable>
            </Band>
          )}

          {!multiPayer && (
            <Pressable
              onPress={() => {
                // Arranca con el pagador actual poniendo todo: el usuario resta
                // desde ahí, que es más rápido que cargar todo de cero.
                setPayers(members.map(uid => ({
                  userId: uid,
                  amount: uid === (payerId || currentUser?.id) ? amount : 0,
                })));
                setMultiPayer(true);
              }}
              hitSlop={8}
              style={styles.inlineLink}
            >
              <Text style={[Typography.bodyS, { color: c.brand.primary }]}>{t('payers.multiple')}</Text>
            </Pressable>
          )}

          {/* Split section */}
          <View style={styles.splitSection}>
            <SectionLabel label={t('expense.split_how')} />

            <View style={styles.segPad}>
              <Segmented
                value={splitMode}
                onChange={handleSplitModeChange}
                options={[
                  { key: 'equal',      label: t('expense.split_mode_equal') },
                  { key: 'percentage', label: t('expense.split_mode_percentage') },
                ]}
              />
            </View>

            {/* Percentage sub-mode */}
            {splitMode === 'percentage' && (
              <>
                <View style={styles.segPad}>
                  <Segmented
                    compact
                    value={percentSub}
                    onChange={handlePercentSubChange}
                    options={[
                      { key: 'same',   label: t('expense.percent_same') },
                      { key: 'custom', label: t('expense.percent_custom') },
                    ]}
                  />
                </View>

                {percentSub === 'same' && (
                  <View style={styles.samePercentRow}>
                    <View style={[styles.samePercentBox, { backgroundColor: c.bgGrouped, borderColor: c.hair }]}>
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
                      {t('expense.percent_same_hint')}
                    </Text>
                  </View>
                )}
              </>
            )}

            {/* Member rows */}
            <Band>
              {splits.map((split, i) => {
                const name    = getUserName(split.userId);
                const isLast  = split.isLast;
                const showRest = isLast && splitMode === 'percentage';

                return (
                  <View
                    key={split.userId}
                    style={[
                      styles.memberRow,
                      {
                        backgroundColor: showRest ? c.brand.primarySoft : 'transparent',
                        borderBottomWidth: i === splits.length - 1 ? 0 : 1,
                        borderBottomColor: c.hair2,
                      },
                    ]}
                  >
                    <UserAvatar userId={split.userId} name={name} size={32} />
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
                          {lastPercent < 0 ? t('expense.percent_exceeded') : t('expense.percent_rest', { pct: roundPct(lastPercent) })}
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
                            {roundPct(parseFloat(samePercent) || 0)}%
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
                <View style={[styles.errorRow, { backgroundColor: c.semantic.errorSoft, borderTopWidth: 1, borderTopColor: c.hair2 }]}>
                  <Ionicons name="warning-outline" size={16} color={c.semantic.error} />
                  <Text style={[Typography.bodyS, { color: c.semantic.error, flex: 1 }]}>
                    {t('expense.percent_over_100')}
                  </Text>
                </View>
              )}
            </Band>
          </View>
          </>)}

          {/* El contador de gastos gratis del día.
              Oculto mientras no haya anuncios: lo que cuenta es cuántos gastos te
              quedan ANTES de tener que ver uno, y sin anuncios no hay tope que
              cruzar —`requiresRewardedAd` devuelve siempre false—. Mostrarlo
              anuncia un límite que la app no aplica, en gastos y en ingresos por
              igual. Vuelve solo el día que `ADS_DISPONIBLES` pase a true. */}
          {ADS_DISPONIBLES && !isEditMode && !isPro && (
            <View style={[styles.tierRow, {
              backgroundColor: c.semantic.warningSoft,
              borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.hair,
            }]}>
              <Ionicons name="information-circle-outline" size={16} color={c.semantic.warning} />
              <Text style={[Typography.bodyS, { color: c.semantic.warning, flex: 1 }]}>
                {t('expense.free_count', { count: dailyCount })}{' '}
                {pasoElTope ? t('expense.free_over') : ''}
              </Text>
            </View>
          )}

          {/* Repetición — sólo al crear; editar una ocurrencia no toca la serie. */}
          {!isEditMode && (
            <View style={styles.recurrencePad}>
              <RecurrencePicker value={recurrence} onChange={setRecurrence} />
            </View>
          )}

          {/* Save button */}
          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            style={[styles.saveBtn, styles.savePad, { backgroundColor: canSave ? c.brand.primary : c.bgGrouped }]}
          >
            <Text style={[Typography.bodyL, { color: canSave ? '#fff' : c.textDisabled, fontWeight: '700' }]}>
              {/* El botón NO promete un anuncio que no existe. */}
              {!isEditMode && needsAd ? t('expense.save_with_ad') : t('expense.save')}
            </Text>
          </Pressable>

        </ScrollView>

        {/* Bottom bar */}
        <View style={[styles.bottomBar, { backgroundColor: c.surface, borderTopColor: c.hair }]}>
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

          <View style={[styles.vDivider, { backgroundColor: c.hair2 }]} />

          {/* Selector de grupo — oculto en modo Ingreso (F-G2) */}
          {!isIncome && (<>
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

          <View style={[styles.vDivider, { backgroundColor: c.hair2 }]} />
          </>)}

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
        <BottomSheet
          visible={showGroup}
          onClose={() => setShowGroup(false)}
          title={t('expense.select_group')}
        >
          <SheetOption
            icon="person-outline"
            label={t('expense.no_group')}
            selected={groupId === ''}
            onPress={() => handleGroupChange('')}
            last={groups.length === 0}
          />
          {groups.map((g, i) => (
            <SheetOption
              key={g.id}
              icon="people-outline"
              label={g.name}
              selected={g.id === groupId}
              onPress={() => handleGroupChange(g.id)}
              last={i === groups.length - 1}
            />
          ))}
        </BottomSheet>
      )}

      {/* Payer picker */}
      <BottomSheet
        visible={showPayer}
        onClose={() => setShowPayer(false)}
        title={t('expense.who_paid')}
      >
        {members.map((userId, i) => (
          <SheetOptionAvatar
            key={userId}
            userId={userId}
            name={getUserName(userId)}
            selected={userId === payerId}
            onPress={() => { setPayerId(userId); setShowPayer(false); }}
            last={i === members.length - 1}
          />
        ))}
      </BottomSheet>

      {/* Date picker */}
      <BottomSheet
        visible={showDate}
        onClose={() => setShowDate(false)}
        title={t('expense.expense_date')}
      >
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
              last={i === 6}
            />
          );
        })}
      </BottomSheet>

      {/* Note */}
      <BottomSheet
        visible={showNote}
        onClose={() => setShowNote(false)}
        title={t('expense.note')}
        scroll={false}
        footer={<SheetButton label={t('common.done')} onPress={() => setShowNote(false)} />}
      >
        <SheetInput
          value={note}
          onChangeText={setNote}
          placeholder={t('expense.note_placeholder')}
          multiline
          numberOfLines={4}
        />
      </BottomSheet>

    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:         { flex: 1 },
  // El scroll ya no tiene padding lateral: cada banda llega borde a borde y el
  // aire vive adentro de la fila.
  /**
   * El aire ENTRE bloques lo pone el contenedor, una sola vez.
   *
   * Antes cada banda era hija directa del scroll sin ninguna separación, y el
   * poco aire que había eran paddings sueltos dentro de algunos wrappers: la
   * pantalla quedaba toda apretada contra el borde de arriba. Con `gap` el
   * ritmo es el mismo entre cualquier par de bloques, aparezcan o no —y acá
   * aparecen o no según haya grupo, según sea edición y según el plan—, que es
   * justo lo que una suma de márgenes por bloque no puede garantizar.
   */
  scroll:       { paddingTop: Spacing[4], paddingBottom: Spacing[4], gap: Spacing[3], flexGrow: 1 },
  segPad:       { paddingHorizontal: Spacing.screenPad },
  recurrencePad:{ paddingHorizontal: Spacing.screenPad },
  /**
   * `marginTop: 'auto'` empuja Guardar al fondo cuando sobra lugar.
   *
   * Un gasto personal tiene la mitad de bloques que uno de grupo —sin pagador y
   * sin reparto—, así que el contenido terminaba a media pantalla y quedaba un
   * vacío enorme debajo del botón. Con el margen automático, Guardar queda
   * arriba de la barra inferior cuando el contenido es corto y fluye normal
   * cuando es largo. Necesita el `flexGrow: 1` del contenedor: sin eso el
   * contenido no ocupa el alto y no hay espacio libre que absorber.
   */
  savePad:      { marginHorizontal: Spacing.screenPad, marginTop: 'auto' },
  inlineLink:   { alignSelf: 'flex-start', paddingHorizontal: Spacing.screenPad, paddingTop: 10 },

  noGroupsState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing[8], gap: Spacing[4],
  },
  noGroupsIcon:  {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing[2],
  },

  // Las pastillas arrancaban pegadas al borde de la pantalla mientras todo lo
  // demás respeta `screenPad`. Van con el mismo margen que el texto de arriba.
  // El scroll no crece con el contenedor…
  categoryScrollBox: { flexGrow: 0 },
  // …y las pastillas se centran en vez de estirarse: en una fila, el
  // `alignItems` por defecto es `stretch`, así que sin esto toman el alto de lo
  // que las contenga.
  categoryScroll: {
    gap: Spacing[2], paddingHorizontal: Spacing.screenPad, paddingVertical: 2,
    alignItems: 'center',
  },
  categoryChip:   {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: Radius.full, borderWidth: 1,
  },

  inputRow:     {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: Spacing.screenPad, paddingVertical: 15,
  },
  descInput:    { flex: 1, padding: 0, fontWeight: '500' },
  amountPad:    { paddingVertical: 22, alignItems: 'center', gap: 4 },
  amountRow:    { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  // 20pt, no 28: con la escala nueva el símbolo descolgaba de la cifra.
  currencySymbol: { fontSize: 20, fontWeight: '400', lineHeight: 34, paddingBottom: 4 },

  row:          {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingVertical: 15,
  },
  rowRight:     { flexDirection: 'row', alignItems: 'center', gap: 8 },

  splitSection: {},
  samePercentRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: Spacing.screenPad, paddingBottom: 14,
  },
  samePercentBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: Radius.lg, borderWidth: 1,
  },
  memberRow:    {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    paddingHorizontal: Spacing.screenPad, paddingVertical: 13,
  },
  percentBox:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  errorRow:     {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: Spacing.screenPad, paddingVertical: 13,
  },
  tierRow:      {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: Spacing.screenPad, paddingVertical: Spacing.rowPadV,
  },

  saveBtn:      { borderRadius: Radius.lg, height: 52, alignItems: 'center', justifyContent: 'center' },

  bottomBar:    {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, height: 56,
    borderTopWidth: 1,
  },
  bottomLeft:   { flexDirection: 'row', alignItems: 'center', gap: 18, paddingHorizontal: 6 },
  vDivider:     { width: 1, height: 22, marginHorizontal: 10 },
  bottomGroup:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6 },
  bottomDate:   { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6 },
});
