import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Typography } from '@/src/constants/typography';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupExpenseCount } from '@/src/store/selectors';
import { useTotalesDelGrupo } from '@/src/store/selectoresDeDeuda';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useGroupSyncFailure } from '@/src/hooks/useSyncFailure';
import { useManifestGap } from '@/src/hooks/useManifestGap';
import { InvitarPorUsernameSheet } from '@/src/screens/groups/components/InvitarPorUsernameSheet';
import { useRecordTrust } from '@/src/hooks/useRecordTrust';
import { DetailHeader, RellenoDetailHeader, useRellenoDetailHeader } from '@/src/components/CollapsibleHeader';
import { useTranslation } from 'react-i18next';
import { esYo } from '@/src/store/identityAlias';
import { useColors } from '@/src/skins/useSkin';
import { useContadorDeRenders } from '@/src/hooks/useContadorDeRenders';
import { armarTimeline, deudasDeGrupo, lineasDeDeudas } from '@/src/screens/groupDetail/detalleDeGrupo';
import { useAltaDeMiembro } from '@/src/screens/groupDetail/hooks/useAltaDeMiembro';
import { useAccionesDeGrupo } from '@/src/screens/groupDetail/hooks/useAccionesDeGrupo';
import { AvisosDeGrupo } from '@/src/screens/groupDetail/components/AvisosDeGrupo';
import { BalanceDeGrupo } from '@/src/screens/groupDetail/components/BalanceDeGrupo';
import { TotalesDeGrupo } from '@/src/screens/groupDetail/components/TotalesDeGrupo';
import { MiembrosDeGrupo } from '@/src/screens/groupDetail/components/MiembrosDeGrupo';
import { TimelineDeGrupo } from '@/src/screens/groupDetail/components/TimelineDeGrupo';
import { PedidoDeSalida } from '@/src/screens/groupDetail/components/PedidoDeSalida';
import { TraspasoManual } from '@/src/screens/groupDetail/components/TraspasoManual';
import { BotonesDeGrupo } from '@/src/screens/groupDetail/components/BotonesDeGrupo';
import { MenuDeGrupo } from '@/src/screens/groupDetail/components/MenuDeGrupo';
import { HojaDeTraspaso } from '@/src/screens/groupDetail/components/HojaDeTraspaso';

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const falloDeSync = useGroupSyncFailure(id as string);
  const manifiestoIncompleto = useManifestGap(id as string);
  const c = useColors();
  // Aero: el header flota y el contenido arranca debajo de su tarjeta (T-227).
  const relleno = useRellenoDetailHeader();

  const { currentUser } = useAuthStore();
  const group        = useGroupStore(s => s.groups.find(g => g.id === id));
  const isArchivedFn  = useArchiveStore(s => s.isArchived);
  // Un grupo ya archivado (incluido el irrevocable por límite, T-058) no
  // puede seguir traspasándose: re-traspasarlo reescribiría
  // `supersededByGroupId` sobre un grupo que ya lo tiene y produciría un
  // segundo grupo nuevo duplicado. Tampoco tiene sentido el aviso del límite
  // acá dentro: no se puede cargar ni un gasto más (guard de `expense/new.tsx`).
  const grupoArchivado = group ? isArchivedFn(group.id) : false;
  const allExpenses  = useExpenseStore(s => s.expenses);

  const allPayments = usePaymentStore(s => s.payments);
  const getUserName = useUserStore(s => s.getUserName);

  const [inviteVisible, setInviteVisible] = useState(false);
  const { handleAddContact, handleAddMemberSinApp } = useAltaDeMiembro(group, () => setInviteVisible(false));

  const timeline = useMemo(() => armarTimeline(allExpenses, allPayments, id), [allExpenses, allPayments, id]);

  const gastosDelTimeline = timeline.flatMap(i => (i.type === 'expense' ? [i.data] : []));
  const pagosDelTimeline  = timeline.flatMap(i => (i.type === 'payment' ? [i.data] : []));
  const marcaDeGasto = useRecordTrust('expense', gastosDelTimeline);
  const marcaDePago  = useRecordTrust('payment', pagosDelTimeline);

  // T-058 (PO 2026-09-20): aviso de traspaso entre 350 y 450 gastos.
  const cantidadGastos = useGroupExpenseCount(id ?? '');
  const [mostrarTraspaso, setMostrarTraspaso] = useState(false);

  // Te deben / Debés del grupo, sin compensar (T-225).
  const totales = useTotalesDelGrupo(id ?? '', currentUser?.id ?? '');
  // T-104/T-113: «Saldar deuda» sólo con deuda viva MÍA. Desde T-225 (PO
  // 2026-09-29) eso es deber algo en alguna moneda, aunque me deban más: con
  // 200 a favor y 60 en contra, los 60 se saldan igual.
  const tieneDeudaViva = totales.some(x => x.youOwe > 0);
  // Varias monedas: se muestra la del grupo, como antes (sin convertir).
  const totalesDeMoneda = totales.find(x => x.currency === group?.currency);
  const owedToYou = totalesDeMoneda?.owedToYou ?? 0;
  const youOwe = totalesDeMoneda?.youOwe ?? 0;

  const [menuVisible, setMenuVisible] = useState(false);

  useContadorDeRenders('Detalle de grupo', {
    expenses: allExpenses.length, payments: allPayments.length, group,
  });

  const { handleShareInvite, handleLeave, handleExpel } = useAccionesDeGrupo({
    group, currentUser, allExpenses, allPayments, getUserName,
  });

  if (!group) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: c.bg }]}>
        <DetailHeader title="" onBack={() => router.back()} />
        <RellenoDetailHeader />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={[Typography.bodyM, { color: c.textTertiary }]}>{t('group_detail.not_found')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const soyMiembro = !!currentUser && group.memberIds.some(esYo);
  // T-228: borrar el grupo avisa quién le debe a quién.
  const avisoDeDeudas = lineasDeDeudas(
    deudasDeGrupo(allExpenses, allPayments, group), getUserName, (k, o) => t(k, o),
  );

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: c.bg }]}>
      <DetailHeader
        title={group.name}
        onBack={() => router.back()}
        right={
          <Pressable
            testID="group-options"
            accessibilityRole="button"
            accessibilityLabel={t('group_detail.options')}
            onPress={() => setMenuVisible(true)}
            hitSlop={12}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={c.text} />
          </Pressable>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: relleno, paddingBottom: 150 }}>
        <AvisosDeGrupo
          falloDeSync={falloDeSync}
          manifiestoIncompleto={manifiestoIncompleto}
          cantidadGastos={cantidadGastos}
          grupoArchivado={grupoArchivado}
          onTraspasar={() => setMostrarTraspaso(true)}
        />

        <TotalesDeGrupo groupId={group.id} currency={group.currency} owedToYou={owedToYou} youOwe={youOwe} />

        <MiembrosDeGrupo uids={group.memberIds} getUserName={getUserName} onPressMember={handleExpel} />

        <TimelineDeGrupo
          timeline={timeline}
          currentUserId={currentUser?.id ?? ''}
          getUserName={getUserName}
          marcaDeGasto={marcaDeGasto}
          marcaDePago={marcaDePago}
        />

        <BalanceDeGrupo groupId={group.id} currency={group.currency} neto={owedToYou - youOwe} />

        {group.leaveRequest && currentUser && (
          <PedidoDeSalida group={group} currentUserId={currentUser.id} getUserName={getUserName} />
        )}

        {/* Salvo que el grupo YA esté archivado: re-traspasar uno ya
            traspasado pisaría su `supersededByGroupId` y crearía un duplicado. */}
        {soyMiembro && !grupoArchivado && (
          <TraspasoManual onPress={() => setMostrarTraspaso(true)} />
        )}
      </ScrollView>

      {soyMiembro && <BotonesDeGrupo groupId={id} tieneDeudaViva={tieneDeudaViva} />}

      <MenuDeGrupo
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        group={group}
        currentUser={currentUser}
        onAddPerson={() => setInviteVisible(true)}
        onShareInvite={() => { void handleShareInvite(); }}
        onLeave={handleLeave}
        lineasDeDeudas={avisoDeDeudas}
      />

      <HojaDeTraspaso
        visible={mostrarTraspaso}
        onClose={() => setMostrarTraspaso(false)}
        group={group}
        currentUser={currentUser}
        cantidadGastos={cantidadGastos}
      />

      {/*
        Antes era un `Modal` + `KeyboardAvoidingView` de mano, con el mismo
        defecto que tenía `BottomSheet` (PO 2026-09-22): en Android el
        teclado tapaba la hoja entera, en iOS la empujaba de un salto. Migrar
        al `BottomSheet` compartido lo hereda arreglado, sin duplicar la
        lógica de teclado acá.

        T-209: el contenido (que necesita `allUsers`) vive en
        `InvitarPorUsernameSheet` — ver el comentario ahí de por qué sigue
        montado siempre (para no perder la animación) en vez de condicionado
        a `inviteVisible` en este JSX.
      */}
      <InvitarPorUsernameSheet
        visible={inviteVisible}
        onClose={() => setInviteVisible(false)}
        title={t('group_detail.add_member_title')}
        group={group}
        currentUser={currentUser}
        onAddContact={handleAddContact}
        onAddWithoutApp={handleAddMemberSinApp}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
});
