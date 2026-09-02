import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { v4 as uuidv4 } from 'uuid';

import { Colors } from '@/src/constants/colors';
import { DetailHeader } from '@/src/components/CollapsibleHeader';

import { Radius, Spacing } from '@/src/constants/spacing';
import { ActionButton } from '@/src/components/ActionButton';
import { Typography } from '@/src/constants/typography';
import { topeDelSaldo, excedeElTope } from '@/src/algorithms/settleScope';
import { acreedoresDe, pagosDelReparto, repartoParejo, totalAdeudado } from '@/src/algorithms/repartoSaldo';
import { formatMoney } from '@/src/constants/currencies';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAmountInput } from '@/src/hooks/useAmountInput';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { calculateBalancesByCurrency } from '@/src/algorithms/calculateBalances';
import { pagosQueCuentan } from '@/src/algorithms/settlementStatus';
import { suggestedSettlement } from '@/src/algorithms/settleSuggestion';
import type { Balance } from '@/src/types/models';
import { hapticSuccess, hapticWarning, hapticSelection } from '@/src/utils/haptics';
import { UserAvatar } from '@/src/components/UserAvatar';
import { BottomSheet, SheetOption, SheetOptionAvatar } from '@/src/components/Sheet';
import { useTranslation } from 'react-i18next';
import i18n from '@/src/i18n';
import { syncedNow } from '@/src/utils/syncedClock';

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
  const allGroups   = useGroupStore(s => s.groups);
  const allExpenses = useExpenseStore(s => s.expenses);
  const allPayments = usePaymentStore(s => s.payments);

  // Params from friends tab: pre-fill who you're paying and how much
  const {
    toId:      paramToId,
    maxAmount: paramMaxStr,
    currency:  paramCurrency,
    groupId:   paramGroupId,
  } = useLocalSearchParams<{
    toId?: string; maxAmount?: string; currency?: string; groupId?: string;
  }>();

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
    // Si venimos del detalle de un grupo, ese grupo manda: el usuario ya eligió
    // dónde está saldando y volver a preguntárselo sería un paso de más.
    const desdeGrupo = paramGroupId ? groups.find(g => g.id === paramGroupId) : undefined;
    if (desdeGrupo) return desdeGrupo;
    if (!isPrefilled) return groups[0];
    return groups.find(g => g.currency === paramCur) ?? groups[0];
  }, [groups, isPrefilled, paramCur, paramGroupId]);

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
  // El que paga soy yo salvo que esté editando el pago de otro: entrar y tener
  // que corregir "de quién sale la plata" es un paso que nadie quiere dar.
  const [fromId,    setFromId]    = useState(
    currentUser && (defaultGroup?.memberIds.includes(currentUser.id) ?? false)
      ? currentUser.id
      : (defaultGroup?.memberIds[0] ?? ''),
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

  /** Balances reales del grupo en esta moneda: gastos MENOS lo ya pagado. */
  const balancesDelGrupo = useMemo<Balance[]>(() => {
    if (!group) return [];

    const porMoneda = calculateBalancesByCurrency(
      allExpenses.filter(e => e.groupId === group.id && !e.isDeleted),
      pagosQueCuentan(allPayments, group).filter(p => !p.isDeleted),
      group.memberIds,
    );
    return porMoneda.map(u => ({
      userId: u.userId,
      amount: u.balances.find(b => b.currency === currency)?.amount ?? 0,
    }));
  }, [group, allExpenses, allPayments, currency]);

  /**
   * Cuánto haría falta para saldar entre estas dos personas. Acotado por los
   * dos lados: pagar de más movería la deuda en vez de saldarla.
   */
  const deudaTotal = useMemo(
    () => suggestedSettlement(balancesDelGrupo, fromId, toId),
    [balancesDelGrupo, fromId, toId],
  );

  const todoSaldado = balancesDelGrupo.length > 0 && balancesDelGrupo.every(b => b.amount === 0);

  /**
   * El monto llega YA PUESTO al elegir a la persona, como en Splitwise: saldar
   * completo es el caso normal y tipearlo a mano deja restos de un peso. Sigue
   * siendo editable — un pago parcial es sólo escribir otro número encima.
   *
   * Se rellena al CAMBIAR de par, no en cada render: si no, pisaría lo que el
   * usuario está escribiendo.
   */
  const ultimoPar = useRef('');
  useEffect(() => {
    const par = `${groupId}|${fromId}|${toId}|${currency}`;
    if (par === ultimoPar.current) return;
    ultimoPar.current = par;
    setAmountMinor(deudaTotal);
  }, [groupId, fromId, toId, currency, deudaTotal, setAmountMinor]);

  /** Lo que hay que mostrarle al lado del nombre al elegir a alguien. */
  function hintDe(uid: string): string | undefined {
    const saldo = balancesDelGrupo.find(b => b.userId === uid)?.amount ?? 0;
    if (saldo === 0) return undefined;
    return saldo > 0
      ? t('settle.hint_owed', { amount: formatMoney(saldo, currency) })
      : t('settle.hint_owes', { amount: formatMoney(Math.abs(saldo), currency) });
  }

  /**
   * El techo real: lo que se debe EN ESTE grupo, nunca más.
   *
   * Antes se validaba contra `maxAmount`, que viniendo de Contactos es el neto
   * GLOBAL entre las dos personas. El monto hablaba de todos los grupos y el
   * pago se registraba en uno solo: así se corrompieron los saldos del PO
   * (T-051). Ahora monto y alcance hablan de lo mismo.
   */
  /**
   * A quiénes les debo en ESTE grupo (ADR-006, decisión 2).
   *
   * Con más de un acreedor, saldar de a uno obliga a repetir la operación
   * tantas veces como personas — y a acordarse de todas. El modo "todo" las
   * cubre de una.
   */
  const acreedores = useMemo(
    () => acreedoresDe(balancesDelGrupo, currentUser?.id ?? ''),
    [balancesDelGrupo, currentUser],
  );
  const deudaEnGrupo = totalAdeudado(acreedores);
  const [modoTodo, setModoTodo] = useState(false);

  const tope       = modoTodo ? deudaEnGrupo : topeDelSaldo(deudaTotal, maxAmount);
  const exceedsMax = excedeElTope(amount, tope);
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

    // Modo "todo": un pago por acreedor. Si el monto no cubre la deuda entera,
    // se reparte parejo — la app OFRECE ese reparto, no lo impone: el usuario
    // puede volver al modo de a uno y decidir a quién le da cuánto.
    if (modoTodo) {
      const reparto = repartoParejo(acreedores, amount);
      for (const pago of pagosDelReparto(reparto, currentUser.id, groupId, currency)) {
        addPayment({
          id:          uuidv4(),
          ...pago,
          date:        date.getTime(),
          createdAt:   Date.now(),
          createdById: currentUser.id,
          updatedAt:   syncedNow(),
          isDeleted:   false,
        });
      }
      router.back();
      return;
    }

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
      updatedAt:   syncedNow(),
      isDeleted:   false,
    });
    router.back();
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        <DetailHeader icon="close" title={t('settle.title')} onBack={() => router.back()} />

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* Con un solo acreedor no hay nada que elegir: mostrar el selector
              sería un paso vacío. Aparece recién cuando hay a quién repartir. */}
          {acreedores.length > 1 && (
            <View style={{ gap: 8 }}>
              <ActionButton
                testID="settle-mode-all"
                label={t('settle.settle_all')}
                sub={t('settle.settle_all_sub', {
                  count: acreedores.length,
                  amount: formatMoney(deudaEnGrupo, currency),
                })}
                icon="people-outline"
                variant={modoTodo ? 'primary' : 'ghost'}
                full
                action={() => { hapticSelection(); setModoTodo(true); setAmountMinor(deudaEnGrupo); }}
              />
              <ActionButton
                testID="settle-mode-one"
                label={t('settle.settle_one')}
                icon="person-outline"
                variant={modoTodo ? 'ghost' : 'primary'}
                full
                action={() => { hapticSelection(); setModoTodo(false); setAmountMinor(deudaTotal); }}
              />
              {modoTodo && amount > 0 && amount < deudaEnGrupo && (
                <Text style={[Typography.bodyS, { color: c.semantic.warning }]}>
                  {t('settle.split_note')}
                </Text>
              )}
            </View>
          )}

          {/* Amount */}
          <View style={[styles.amountCard, { backgroundColor: c.surface, borderColor: exceedsMax ? c.semantic.negative : c.hair }]}>
            <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>
              {currency}
            </Text>
            <View style={styles.amountRow}>
              <View style={styles.amountGroup}>
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
              {deudaTotal > 0 && (
                <ActionButton
                  testID="settle-max"
                  size="sm"
                  variant="plain"
                  label={t('settle.max')}
                  accessibilityLabel={t('settle.max_a11y')}
                  action={() => { hapticSelection(); setAmountMinor(tope); }}
                />
              )}
            </View>
            {/* Sólo la deuda pendiente: el atajo MAX volvió arriba, al lado del
                número que va a escribir (pedido del PO). Lo que lo había echado
                de ahí era que se cortaba en pantallas angostas — la fila se
                encogía al contenido dentro de una tarjeta centrada. Eso ahora
                no puede pasar: la fila es `stretch` y el que cede ancho es el
                monto (`flexShrink: 1`), nunca el botón. */}
            {deudaTotal > 0 && (
              <View style={styles.outstandingRow}>
                <View testID="settle-outstanding" style={{ flexDirection: 'row', gap: 6 }}>
                  <Text style={[Typography.bodyS, { color: c.textTertiary }]} numberOfLines={1}>
                    {t('settle.outstanding_label')}
                  </Text>
                  {/* El monto va FUERA del string traducido: dentro, ninguna
                      prueba puede verlo sin conocer la clave, y el número queda
                      a merced de cómo esté redactada cada traducción. */}
                  <Text style={[Typography.bodyS, { color: c.textSecondary, fontWeight: '700' }]} numberOfLines={1}>
                    {formatMoney(deudaTotal, currency)}
                  </Text>
                </View>
              </View>
            )}

            {todoSaldado && (
              <View style={[styles.wholeDebt, { backgroundColor: c.semantic.positiveSoft, borderColor: 'transparent' }]}>
                <Ionicons name="checkmark-circle" size={14} color={c.semantic.positiveOnSoft} />
                <Text style={[Typography.bodyS, { color: c.semantic.positiveOnSoft, fontWeight: '600' }]}>
                  {t('settle.all_settled')}
                </Text>
              </View>
            )}


            {maxAmount !== undefined && (
              <View style={[styles.maxHint, { backgroundColor: exceedsMax ? c.semantic.negativeSoft : c.bgGrouped }]}>
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
          <View style={[styles.transferCard, { backgroundColor: c.surface, borderColor: c.hair }]}>
            <Pressable
              onPress={isPrefilled ? undefined : () => setShowFrom(true)}
              style={styles.transferSide}
            >
              <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase', marginBottom: 8 }]}>
                {t('settle.from_label')}
              </Text>
              {fromId ? (
                <View style={styles.transferUser}>
                  <UserAvatar userId={fromId} name={getUserName(fromId)} size={36} />
                  <Text style={[Typography.bodyS, { color: c.text, fontWeight: '600', textAlign: 'center' }]} numberOfLines={2}>
                    {fromId === currentUser?.id ? t('common.you') : getUserName(fromId)}
                  </Text>
                </View>
              ) : (
                <Text style={[Typography.bodyM, { color: c.textTertiary }]}>{t('settle.select')}</Text>
              )}
            </Pressable>

            <View style={[styles.arrowBox, { backgroundColor: c.bgGrouped }]}>
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
                  <UserAvatar userId={toId} name={getUserName(toId)} size={36} />
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
              style={[styles.metaChip, { backgroundColor: c.surface, borderColor: c.hair, flex: 1 }]}
            >
              <Ionicons name="people-outline" size={14} color={c.textSecondary} />
              <Text style={[Typography.bodyS, { color: c.text, fontWeight: '600', flex: 1 }]} numberOfLines={1}>
                {group?.name ?? t('expense.no_group_short')}
              </Text>
              <Ionicons name="chevron-down" size={14} color={c.textTertiary} />
            </Pressable>

            <Pressable
              onPress={() => { hapticSelection(); setShowDate(true); }}
              style={[styles.metaChip, { backgroundColor: c.surface, borderColor: c.hair }]}
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
            style={[styles.saveBtn, { backgroundColor: canSave ? c.brand.primary : c.bgGrouped }]}
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
              hint={hintDe(uid)}
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
              hint={hintDe(uid)}
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
  wholeDebt: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', marginTop: Spacing[3],
    paddingVertical: Spacing[2], paddingHorizontal: Spacing[3],
    borderRadius: Radius.full, borderWidth: 1,
  },
  safe:           { flex: 1 },
  scroll:         { paddingHorizontal: Spacing.screenPad, paddingTop: Spacing[4], gap: Spacing[3] },
  amountCard:     {
    borderRadius: Radius.lg, borderWidth: 1,
    paddingVertical: 20, alignItems: 'center', gap: 4,
  },
  // `stretch` + `center`: la fila ocupa todo el ancho de la tarjeta y centra su
  // contenido, en vez de encogerse a él. Es lo que impide que MAX se salga por
  // el borde cuando el monto es largo — antes la fila crecía con el número.
  amountRow:      {
    alignSelf: 'stretch', flexDirection: 'row',
    alignItems: 'flex-end', justifyContent: 'center',
    gap: Spacing[4], paddingHorizontal: Spacing[4],
  },
  // El monto es el que cede ancho si no entra todo; MAX no se toca.
  amountGroup:    { flexDirection: 'row', alignItems: 'flex-end', gap: 6, flexShrink: 1 },
  // Ancho completo dentro de una tarjeta centrada: sin `alignSelf: stretch` la
  // fila se encoge al contenido y el botón se sale del borde.
  outstandingRow: {
    alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8,
    paddingHorizontal: Spacing[4], marginTop: 8,
  },
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
