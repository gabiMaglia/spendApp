import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { hapticSelection } from '@/src/utils/haptics';
import type { RecurrenceValue } from '@/src/components/RecurrencePicker';
import { validatePayers } from '@/src/algorithms/payers';
import { estaBloqueado } from '@/src/algorithms/groupExpenseLimit';
import { Spacing } from '@/src/constants/spacing';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useAmountInput } from '@/src/hooks/useAmountInput';
import { useContadorDeRenders } from '@/src/hooks/useContadorDeRenders';
import { useAuthStore } from '@/src/store/authStore';
import { useTierStore } from '@/src/store/tierStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useGroupExpenseCount } from '@/src/store/selectors';
import { DetailHeader, useRellenoDetailHeader } from '@/src/components/CollapsibleHeader';
import { useColors, useSkinTokens } from '@/src/skins/useSkin';
import { formatMoney } from '@/src/constants/currencies';
import { useUserStore } from '@/src/store/userStore';
import type { Payer, PersonalCategory } from '@/src/types/models';
import { useRepartoDeGasto } from '@/src/screens/expense/hooks/useRepartoDeGasto';
import { useGuardarGasto } from '@/src/screens/expense/hooks/useGuardarGasto';
import { HeroMonto } from '@/src/screens/expense/components/HeroMonto';
import { CategoriaChips, DescripcionCard } from '@/src/screens/expense/components/DescripcionYCategorias';
import { BloquePagador } from '@/src/screens/expense/components/BloquePagador';
import { BloqueReparto } from '@/src/screens/expense/components/BloqueReparto';
import { PieDeGuardar } from '@/src/screens/expense/components/PieDeGuardar';
import { BarraUtilidades } from '@/src/screens/expense/components/BarraUtilidades';
import { HojasDeGasto, type HojaAbierta } from '@/src/screens/expense/components/HojasDeGasto';
import { HojasSplitwise } from '@/src/screens/expense/components/HojasSplitwise';
import { SelectorDeTipo } from '@/src/screens/expense/components/SelectorDeTipo';
import { ConQuien } from '@/src/screens/expense/components/ConQuien';
import { TarjetaDescripcionMonto } from '@/src/screens/expense/components/TarjetaDescripcionMonto';
import { GrillaCategorias } from '@/src/screens/expense/components/GrillaCategorias';
import { FraseDeReparto } from '@/src/screens/expense/components/FraseDeReparto';
import { BarraDeHerramientas } from '@/src/screens/expense/components/BarraDeHerramientas';

/**
 * **Nuevo gasto / Editar gasto / Nuevo ingreso.**
 *
 * T-223 (PO 2026-09-29): esta pantalla tenía 1300 líneas. Acá queda el estado
 * del formulario, lo que se deriva de él y el orden de los bloques; cada
 * bloque, la lógica pura del reparto y el guardado viven en
 * `src/screens/expense/`.
 */
export default function NewExpenseScreen() {
  const { t } = useTranslation();
  const c = useColors();
  // Aero: alta con la estructura de Splitwise (feat/reskin, variante B4).
  // Clásico conserva su formulario de bloques abiertos (T-210).
  const soft = useSkinTokens().flags.soft;
  const getUserName = useUserStore(s => s.getUserName);
  // Aero: el header flota y el contenido arranca debajo de su tarjeta (T-227).
  const relleno = useRellenoDetailHeader();

  const { currentUser, isPro } = useAuthStore();
  const requiresRewardedAd = useTierStore(s => s.requiresRewardedAd);
  const superoElTope = useTierStore(s => s.superoElTope);
  const getDailyCount = useTierStore(s => s.getDailyCount);
  const allGroups = useGroupStore(s => s.groups);
  const groups = useMemo(() => allGroups.filter(g => !g.isDeleted), [allGroups]);

  const { groupId: paramGroupId, expenseId, allowIncome, kind: paramKind } =
    useLocalSearchParams<{ groupId?: string; expenseId?: string; allowIncome?: string; kind?: string }>();

  // En edición: el gasto existente precarga el formulario.
  const existingExpense = useExpenseStore(s =>
    expenseId ? s.expenses.find(e => e.id === expenseId) : undefined,
  );
  const isEditMode = Boolean(expenseId);

  // ── Core inputs ────────────────────────────────────────────────────────────
  const [description, setDescription] = useState(existingExpense?.description ?? '');
  // Default: SIN grupo (gasto personal). Si viene por deep-link de un grupo
  // (paramGroupId) o en edición, se pre-selecciona ese grupo. (F-G, decisión PO)
  const [groupId, setGroupId] = useState(existingExpense?.groupId ?? paramGroupId ?? '');
  // Moneda del grupo activo, resuelta temprano — el input de monto (entero,
  // menor unidad — ADR-002) la necesita para parsear/formatear correctamente.
  const currency: CurrencyCode = groups.find(g => g.id === groupId)?.currency ?? 'ARS';
  const {
    text: amountStr, minor: amount, onChangeText: setAmountStr, onBlur: onAmountBlur, setMinor: setAmountMinor,
  } = useAmountInput(currency, existingExpense?.amount ?? 0);
  const [payerId, setPayerId] = useState(existingExpense?.paidById ?? currentUser?.id ?? '');
  const [date, setDate] = useState(existingExpense ? new Date(existingExpense.date) : new Date());
  const [note, setNote] = useState(existingExpense?.note ?? '');
  const [category, setCategory] = useState<PersonalCategory>(existingExpense?.category ?? 'other');
  // Modo Ingreso: SOLO habilitado cuando se abre desde Personal (allowIncome=1). (F-G2)
  const incomeAllowed = allowIncome === '1' && !isEditMode;
  const [entryKind, setEntryKind] = useState<'expense' | 'income'>(
    incomeAllowed && paramKind === 'income' ? 'income' : 'expense',
  );
  const isIncome = incomeAllowed && entryKind === 'income';
  const [receiptUri, setReceiptUri] = useState<string | undefined>(existingExpense?.receiptImageUri);
  const [hoja, setHoja] = useState<HojaAbierta>(null);
  const [recurrence, setRecurrence] = useState<RecurrenceValue>(null);
  const [multiPayer, setMultiPayer] = useState(false);
  const [payers, setPayers] = useState<Payer[]>([]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const group   = groups.find(g => g.id === groupId);
  const members = group?.memberIds ?? [];
  const reparto = useRepartoDeGasto(existingExpense, amount, members);

  useContadorDeRenders('Nuevo gasto', { amount, groupId, splitMode: reparto.splitMode, description });

  const dailyCount = currentUser ? getDailyCount(currentUser.id) : 0;
  // Dos cosas distintas, y confundirlas era el bug: `superoElTope` es la REGLA
  // (pasaste los 4 del día) y sirve para contárselo al usuario; `needsAd` es si
  // hay que mostrarle un anuncio ANTES de guardar, que hoy es siempre false
  // porque no existe el sistema de anuncios. Ver `ADS_DISPONIBLES`.
  const pasoElTope = !isEditMode && currentUser ? superoElTope(currentUser.id, isPro) : false;
  const needsAd    = !isEditMode && currentUser ? requiresRewardedAd(currentUser.id, isPro) : false;

  // hasGroup=false ⇒ gasto PERSONAL (sin repartos, sin pagador). (F-G)
  const hasGroup = groupId !== '';
  // PO 2026-09-20: un grupo archivado (cualquier razón) es de solo lectura.
  const isArchivedFn = useArchiveStore(s => s.isArchived);
  const grupoArchivado = hasGroup && isArchivedFn(groupId);
  // T-058 (PO 2026-09-20): grupo que llegó a 450 gastos no acepta uno más.
  // `!isEditMode` importa: editar uno de los 450 no hace crecer el conteo.
  const cantidadGastosDelGrupo = useGroupExpenseCount(hasGroup ? groupId : '');
  const grupoBloqueadoPorLimite = hasGroup && !isEditMode && estaBloqueado(cantidadGastosDelGrupo);
  // Con varios pagadores la suma tiene que dar EXACTA contra el total: son
  // enteros en menor unidad (ADR-002), no hay redondeo que perdonar.
  const payersOk = !multiPayer || validatePayers(payers.filter(p => p.amount > 0), amount).ok;
  const canSave = description.trim().length > 0 && amount > 0 && !reparto.percentError
    && (!hasGroup || members.length > 0) && payersOk && !grupoArchivado && !grupoBloqueadoPorLimite;

  const guardar = useGuardarGasto({
    currentUser, isEditMode, expenseId, existingExpense, hasGroup, groupId, group,
    description, amount, currency, category, date, note, receiptUri, isIncome,
    payerId, multiPayer, payers, splits: reparto.splits, splitMode: reparto.splitMode,
    recurrence, needsAd, canSave,
  });

  // Lo que dice la frase de Aero («Pagado por vos y dividido en partes iguales»).
  const payerLabel = multiPayer ? t('expense.phrase_several')
    : payerId === currentUser?.id ? t('expense.you') : getUserName(payerId);
  const splitLabel = reparto.splitMode === 'equal' ? t('expense.phrase_equally') : t('expense.phrase_percentage');
  const resumen = reparto.splitMode === 'equal' && amount > 0 && members.length > 0
    ? t('expense.phrase_each', { amount: formatMoney(reparto.splits[0]?.amount ?? 0, currency), count: members.length })
    : t('expense.phrase_between', { count: members.length });

  // ── Handlers ───────────────────────────────────────────────────────────────
  function handleGroupChange(id: string) {
    const newMembers = groups.find(g => g.id === id)?.memberIds ?? [];
    setGroupId(id);
    reparto.reiniciarParaMiembros(newMembers);
    setPayerId(currentUser && newMembers.includes(currentUser.id) ? currentUser.id : (newMembers[0] ?? ''));
    // Re-normaliza el texto del input a las reglas de decimales de la nueva
    // moneda (p.ej. si el nuevo grupo es CLP/PYG, sin decimales).
    setAmountMinor(amount);
    setHoja(null);
  }

  function switchEntryKind(k: 'expense' | 'income') {
    hapticSelection();
    setEntryKind(k);
    // Ingreso no tiene selector de categoría (PO 2026-09-13): siempre "otros".
    setCategory('other');
    if (k === 'income') setGroupId(''); // el ingreso no lleva grupo
  }

  // T-210: arranca con el pagador actual poniendo todo (el usuario resta desde
  // ahí) o vuelve a pagador único.
  function togglePayerMode() {
    if (multiPayer) {
      setMultiPayer(false);
      setPayers([]);
    } else {
      setPayers(members.map(uid => ({ userId: uid, amount: uid === (payerId || currentUser?.id) ? amount : 0 })));
      setMultiPayer(true);
    }
  }

  // Aero: Guardar queda fijo arriba de la barra, fuera del scroll (B4); en
  // Clásico sigue al pie del formulario.
  const pie = (
    <PieDeGuardar
      conRepetir={!soft}
      isEditMode={isEditMode}
      isPro={isPro}
      dailyCount={dailyCount}
      pasoElTope={pasoElTope}
      recurrence={recurrence}
      onRecurrenceChange={setRecurrence}
      grupoArchivado={grupoArchivado}
      grupoBloqueadoPorLimite={grupoBloqueadoPorLimite}
      canSave={canSave}
      needsAd={needsAd}
      onSave={guardar}
    />
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: c.bg }]}>
      {/* B3 (lote 2026-09-28): sin `behavior` en Android — Expo deja
          `windowSoftInputMode` en `adjustResize` y el SO ya redimensiona; sumarle
          `behavior="height"` hacía competir dos mecanismos y la fila de chips
          quedaba arriba al cerrar el teclado. */}
      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <DetailHeader
          icon="close"
          title={isEditMode ? t('expense.edit_title') : isIncome ? t('expense.new_income_title') : t('expense.new_title')}
          onBack={() => router.back()}
        />

        <ScrollView
          style={styles.safe}
          contentContainerStyle={[styles.scroll, { paddingTop: Spacing[3] + relleno }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {soft ? (
            <>
              {incomeAllowed && <SelectorDeTipo isIncome={isIncome} onChange={switchEntryKind} />}
              {!isIncome && (
                <ConQuien
                  groupName={group?.name ?? t('expense.no_group_short')}
                  onPress={() => setHoja('grupo')}
                  disabled={isEditMode}
                />
              )}
              <TarjetaDescripcionMonto
                category={category}
                isIncome={isIncome}
                currency={currency}
                description={description}
                onDescriptionChange={setDescription}
                amount={amountStr}
                onAmountChange={setAmountStr}
                onAmountBlur={onAmountBlur}
              />
              {!isIncome && <GrillaCategorias value={category} onChange={setCategory} />}
              {hasGroup && (
                <FraseDeReparto
                  payerLabel={payerLabel}
                  splitLabel={splitLabel}
                  resumen={resumen}
                  onOpenPayer={() => setHoja('pagadores')}
                  onOpenSplit={() => setHoja('reparto')}
                />
              )}
            </>
          ) : (
            <>
              <HeroMonto
                currency={currency}
                value={amountStr}
                onChangeText={setAmountStr}
                onBlur={onAmountBlur}
                incomeAllowed={incomeAllowed}
                isIncome={isIncome}
                onKindChange={switchEntryKind}
              />
              <DescripcionCard value={description} onChangeText={setDescription} isIncome={isIncome} />
              {/* El ingreso no tiene categorías (PO 2026-09-13): se guarda con "otros". */}
              {!isIncome && <CategoriaChips value={category} onChange={setCategory} />}

              {hasGroup && (
                <>
                  <BloquePagador
                    members={members}
                    payerId={payerId}
                    multiPayer={multiPayer}
                    payers={payers}
                    amount={amount}
                    currency={currency}
                    onPayersChange={setPayers}
                    onOpenPayer={() => setHoja('pagador')}
                    onTogglePayerMode={togglePayerMode}
                  />
                  <BloqueReparto
                    splitMode={reparto.splitMode}
                    percentSub={reparto.percentSub}
                    samePercent={reparto.samePercent}
                    customPercents={reparto.customPercents}
                    splits={reparto.splits}
                    lastPercent={reparto.lastPercent}
                    percentError={reparto.percentError}
                    currency={currency}
                    onSplitModeChange={reparto.cambiarModo}
                    onPercentSubChange={reparto.cambiarSubModo}
                    onSamePercentChange={reparto.setSamePercent}
                    onCustomPercentsChange={reparto.setCustomPercents}
                  />
                </>
              )}
            </>
          )}

          {!soft && pie}
        </ScrollView>

        {soft && pie}
        {soft ? (
          <BarraDeHerramientas
            date={date}
            onOpenDate={() => setHoja('fecha')}
            recurrence={recurrence}
            onOpenRecurrence={() => setHoja('repetir')}
            showRecurrence={!isEditMode}
            receiptUri={receiptUri}
            onReceiptChange={setReceiptUri}
            note={note}
            onOpenNote={() => setHoja('nota')}
          />
        ) : (
          <BarraUtilidades
            receiptUri={receiptUri}
            onReceiptChange={setReceiptUri}
            note={note}
            onOpenNote={() => setHoja('nota')}
            isIncome={isIncome}
            isEditMode={isEditMode}
            groupName={group?.name ?? t('expense.no_group_short')}
            onOpenGroup={() => setHoja('grupo')}
            date={date}
            onOpenDate={() => setHoja('fecha')}
          />
        )}
      </KeyboardAvoidingView>

      <HojasDeGasto
        abierta={hoja}
        onClose={() => setHoja(null)}
        isEditMode={isEditMode}
        groups={groups}
        groupId={groupId}
        onGroupChange={handleGroupChange}
        members={members}
        payerId={payerId}
        onPayerChange={setPayerId}
        date={date}
        onDateChange={setDate}
        note={note}
        onNoteChange={setNote}
      />
      {soft && (
        <HojasSplitwise
          abierta={hoja}
          onClose={() => setHoja(null)}
          members={members}
          payerId={payerId}
          onPayerChange={setPayerId}
          multiPayer={multiPayer}
          payers={payers}
          amount={amount}
          currency={currency}
          onPayersChange={setPayers}
          onTogglePayerMode={togglePayerMode}
          reparto={reparto}
          recurrence={recurrence}
          onRecurrenceChange={setRecurrence}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  /**
   * El aire ENTRE bloques lo pone el contenedor, una sola vez, con `gap`: los
   * bloques aparecen o no según haya grupo, sea edición o el plan, y una suma
   * de márgenes por bloque no garantiza el mismo ritmo. Sin padding lateral:
   * las bandas de grupo/reparto van borde a borde con el aire adentro de cada
   * fila; las tarjetas (héroe, descripción) ponen su `marginHorizontal`.
   * `flexGrow: 1` es lo que deja a Guardar irse al fondo (`marginTop: 'auto'`).
   */
  scroll: { paddingTop: Spacing[3], paddingBottom: Spacing[4], gap: Spacing[3], flexGrow: 1 },
});
