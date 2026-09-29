import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { DetailHeader, useRellenoDetailHeader } from '@/src/components/CollapsibleHeader';
import { Spacing } from '@/src/constants/spacing';
import { ActionButton } from '@/src/components/ActionButton';
import { ButtonRack } from '@/src/components/ButtonRack';
import { topeDelSaldo, excedeElTope } from '@/src/algorithms/settleScope';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useAmountInput } from '@/src/hooks/useAmountInput';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { hapticSelection } from '@/src/utils/haptics';
import { esYo } from '@/src/store/identityAlias';
import { useColors } from '@/src/skins/useSkin';
import { hintDe, puedeGuardarSaldo } from '@/src/screens/settle/saldoDeGrupo';
import { useDeudaDelPar } from '@/src/screens/settle/hooks/useDeudaDelPar';
import { useGuardarSaldo } from '@/src/screens/settle/hooks/useGuardarSaldo';
import { SelectorModoSaldo } from '@/src/screens/settle/components/SelectorModoSaldo';
import { HeroSaldo } from '@/src/screens/settle/components/HeroSaldo';
import { TarjetaTransferencia } from '@/src/screens/settle/components/TarjetaTransferencia';
import { FilasGrupoYFecha } from '@/src/screens/settle/components/FilasGrupoYFecha';
import { HojasDeSaldo } from '@/src/screens/settle/components/HojasDeSaldo';
import { SaldarConAmigo } from '@/src/screens/settle/components/SaldarConAmigo';

/**
 * **Saldar deuda.**
 *
 * T-223 (PO 2026-09-29): esta pantalla tenía 635 líneas. Acá queda el estado,
 * lo que se deriva de él y el orden de los bloques; los bloques, la deuda del
 * par, el guardado y la lógica pura viven en `src/screens/settle/`.
 */
export default function SettleNewScreen() {
  const { toId, groupId } = useLocalSearchParams<{ toId?: string; groupId?: string }>();
  // T-225: desde Amigos llega la persona sin grupo — se salda el total con
  // ella en todos los grupos compartidos, no un monto en uno solo.
  if (toId && !groupId) return <SaldarConAmigo amigoId={toId} />;
  return <SaldarEnGrupo />;
}

function SaldarEnGrupo() {
  const { t } = useTranslation();
  const c = useColors();
  // Aero: el header flota y el contenido arranca debajo de su tarjeta (T-227).
  const relleno = useRellenoDetailHeader();

  const { currentUser } = useAuthStore();
  const { addPayment } = usePaymentStore();
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
      g.memberIds.some(esYo) && g.memberIds.includes(paramToId),
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
    currentUser && (defaultGroup?.memberIds.some(esYo) ?? false)
      ? currentUser.id
      : (defaultGroup?.memberIds[0] ?? ''),
  );
  const [toId, setToId] = useState(
    isPrefilled && paramToId ? paramToId : (defaultGroup?.memberIds.filter(uid => !esYo(uid) && uid !== fromId)[0] ?? ''),
  );
  const [date,      setDate]      = useState(new Date());

  const [showGroup, setShowGroup] = useState(false);
  const [showFrom,  setShowFrom]  = useState(false);
  const [showTo,    setShowTo]    = useState(false);
  const [showDate,  setShowDate]  = useState(false);

  const group    = groups.find(g => g.id === groupId);
  const isArchivedFn  = useArchiveStore(s => s.isArchived);
  const grupoArchivado = group ? isArchivedFn(group.id) : false;
  const members  = group?.memberIds ?? [];
  const currency = currencyForAmount;
  const toOptions = members.filter(uid => uid !== fromId);

  const { balancesDelGrupo, deudaTotal, todoSaldado, acreedores, deudaEnGrupo } = useDeudaDelPar({
    group, allExpenses, allPayments, currency, groupId, fromId, toId,
    currentUserId: currentUser?.id ?? '', setAmountMinor,
  });
  const [modoTodo, setModoTodo] = useState(false);

  const tope       = modoTodo ? deudaEnGrupo : topeDelSaldo(deudaTotal, maxAmount);
  const exceedsMax = excedeElTope(amount, tope);
  const canSave    = puedeGuardarSaldo({ amount, exceedsMax, fromId, toId, groupId, grupoArchivado });

  const handleSave = useGuardarSaldo({
    canSave, exceedsMax, currentUser, modoTodo, acreedores, amount,
    groupId, fromId, toId, currency, date, addPayment,
  });

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

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        <DetailHeader icon="close" title={t('settle.title')} onBack={() => router.back()} />

        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: Spacing[4] + relleno }]} keyboardShouldPersistTaps="handled">

          {/* Con un solo acreedor no hay nada que elegir: mostrar el selector
              sería un paso vacío. Aparece recién cuando hay a quién repartir. */}
          {acreedores.length > 1 && (
            <SelectorModoSaldo
              cantidadAcreedores={acreedores.length}
              deudaEnGrupo={deudaEnGrupo}
              currency={currency}
              modoTodo={modoTodo}
              amount={amount}
              onTodo={() => { hapticSelection(); setModoTodo(true); setAmountMinor(deudaEnGrupo); }}
              onUno={() => { hapticSelection(); setModoTodo(false); setAmountMinor(deudaTotal); }}
            />
          )}

          <HeroSaldo
            currency={currency}
            value={amountStr}
            onChangeText={setAmountStr}
            onBlur={onAmountBlur}
            exceedsMax={exceedsMax}
            deudaTotal={deudaTotal}
            todoSaldado={todoSaldado}
            maxAmount={maxAmount}
            onMax={() => { hapticSelection(); setAmountMinor(tope); }}
          />

          <TarjetaTransferencia
            fromId={fromId}
            toId={toId}
            onPressFrom={isPrefilled ? undefined : () => setShowFrom(true)}
            onPressTo={isPrefilled ? undefined : () => setShowTo(true)}
          />

          <FilasGrupoYFecha
            nombreGrupo={group?.name}
            date={date}
            onPressGrupo={() => { hapticSelection(); setShowGroup(true); }}
            onPressFecha={() => { hapticSelection(); setShowDate(true); }}
          />

          {/* El botón de la app, no un Pressable con estilo propio: es la
              regla del proyecto y lo que hace que «guardar» se vea igual en
              todas las pantallas. */}
          <ButtonRack style={styles.alFondo}>
            <ActionButton
              testID="settle-save"
              label={t('settle.title')}
              size="lg"
              full
              disabled={!canSave}
              action={handleSave}
            />
          </ButtonRack>
        </ScrollView>
      </KeyboardAvoidingView>

      <HojasDeSaldo
        isPrefilled={isPrefilled}
        showGroup={showGroup} onCloseGroup={() => setShowGroup(false)}
        groups={groups} groupId={groupId} onGroupChange={handleGroupChange}
        showFrom={showFrom} onCloseFrom={() => setShowFrom(false)}
        members={members} fromId={fromId} onFromChange={handleFromChange}
        showTo={showTo} onCloseTo={() => setShowTo(false)}
        toOptions={toOptions} toId={toId}
        onToChange={uid => { hapticSelection(); setToId(uid); setShowTo(false); }}
        showDate={showDate} onCloseDate={() => setShowDate(false)}
        date={date}
        onDateChange={d => { hapticSelection(); setDate(d); setShowDate(false); }}
        hintDe={uid => hintDe(balancesDelGrupo, uid, currency, t)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1 },
  scroll:         { paddingHorizontal: Spacing.screenPad, paddingTop: Spacing[4], gap: Spacing[3], flexGrow: 1 },
  // «Registrar pago» al fondo de la pantalla, como «Crear» en Nuevo grupo (PO
  // 2026-09-29): `marginTop: 'auto'` absorbe el alto que sobra; necesita el
  // `flexGrow: 1` del contenedor del scroll.
  alFondo: { marginTop: 'auto' },
});
