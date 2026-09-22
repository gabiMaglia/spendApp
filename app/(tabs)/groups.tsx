import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHeaderColapsable } from '@/src/hooks/useHeaderColapsable';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupBalance, useGroupExpenseCount, useGroupsNetBalanceFor, useGroupsTotalBalance } from '@/src/store/selectors';
import { Fab, FabRow } from '@/src/components/Fab';
import { useFx } from '@/src/store/useFx';
import { sumConverted } from '@/src/services/fxTotals';
import { GroupCard } from '@/src/components/GroupCard';
import { MontoRodante } from '@/src/components/MontoRodante';
import { SwipeToArchive } from '@/src/components/SwipeToArchive';
import { EmptyState } from '@/src/components/EmptyState';
import { Band, Segmented, StatGrid } from '@/src/components/Band';
import { TabHeader } from '@/src/components/TabHeader';
import { useHeaderPadding, useLimiteContenido } from '@/src/components/CollapsibleHeader';
import { hapticLight } from '@/src/utils/haptics';
import type { Group } from '@/src/types/models';
import { esYo } from '@/src/store/identityAlias';

export default function GroupsScreen() {
  const { t } = useTranslation();
  // Sin aire entre el header y el primer elemento (PO 2026-09-13, T-130).
  const headerPad = useHeaderPadding(0);
  const limiteContenido = useLimiteContenido();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { currentUser } = useAuthStore();
  const allGroups   = useGroupStore(s => s.groups);
  const archivedIds = useArchiveStore(s => s.archivedIds);
  const setArchived = useArchiveStore(s => s.setArchived);
  const canUnarchive = useArchiveStore(s => s.canUnarchive);
  const groupTotals = useGroupsTotalBalance(currentUser?.id ?? '');

  const { scrollHandler, progress, contenidoMinimo, alMedirScroll } = useHeaderColapsable();

  const { fx, display: cur } = useFx();
  const deben = sumConverted(
    groupTotals.map(g => ({ currency: g.currency, minor: g.owedToYou })), cur, fx,
  );
  const debo = sumConverted(
    groupTotals.map(g => ({ currency: g.currency, minor: g.youOwe })), cur, fx,
  );
  const owedToYou = deben.totalMinor;
  const youOwe    = debo.totalMinor;

  const myGroups = useMemo(
    () => allGroups.filter(g => !g.isDeleted && (!currentUser || g.memberIds.some(esYo))),
    [allGroups, currentUser],
  );

  const [tabActual, setTab] = useState<'activos' | 'archivados'>('activos');

  const visibles = useMemo(
    () => myGroups.filter(g => archivedIds.includes(g.id) === (tabActual === 'archivados')),
    [myGroups, archivedIds, tabActual],
  );

  // "Total total" al pie de la lista (PO 2026-09-22): a diferencia de los
  // cuatro casilleros de arriba —que describen "tu situación" y no se mueven
  // con la pestaña—, esto SÍ cambia: es la cuenta separada de lo que se ve
  // ahora mismo, activos o archivados según la pestaña.
  const idsVisibles = useMemo(() => new Set(visibles.map(g => g.id)), [visibles]);
  const netVisibles = useGroupsNetBalanceFor(currentUser?.id ?? '', idsVisibles);
  const netTotal = sumConverted(
    netVisibles.map(b => ({ currency: b.currency, minor: b.net })), cur, fx,
  ).totalMinor;

  /** Los grupos activos. No depende de la pestaña, y eso es a propósito. */
  const idsActivos = useMemo(
    () => new Set(myGroups.filter(g => !archivedIds.includes(g.id)).map(g => g.id)),
    [myGroups, archivedIds],
  );

  /**
   * Gastos vivos de los grupos activos. Como los otros tres indicadores, no
   * depende de la pestaña: los cuatro describen tu situación, no la lista que
   * estás mirando.
   */
  const gastos = useExpenseStore(
    s => s.expenses.filter(e => !e.isDeleted && idsActivos.has(e.groupId)).length,
  );

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: c.bg }]}>
      <Animated.ScrollView
        style={limiteContenido}
        onLayout={alMedirScroll}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={scrollHandler}
        contentContainerStyle={[{ paddingTop: headerPad, paddingBottom: 150, flexGrow: 1 }, contenidoMinimo]}
      >

        {/* **Todo lo de arriba del segmentado no depende de la pestaña.**
            Antes este bloque estaba condicionado a que la lista tuviera items,
            así que al pasar a Archivados —normalmente vacío— desaparecía y el
            segmentado y la lista saltaban hacia arriba. Cambiar de pestaña tiene
            que cambiar sólo lo de abajo (pedido del PO).

            Por la misma razón el contador cuenta los grupos ACTIVOS y no los
            visibles: los saldos de al lado son globales y no se mueven, y un
            número que cambia al lado de dos que no, se lee como un error. */}
        {/* Cuatro indicadores en 2×2 (PO 2026-09-02). Ninguno depende de la
            pestaña: describen tu situación, no la lista de abajo. Cambiar de
            Activos a Archivados tiene que mover SOLO lo que está debajo del
            selector. */}
        <StatGrid
          items={[
            { label: t('groups.stat_groups'),  value: String(idsActivos.size), id: 'groups.count', minor: idsActivos.size },
            { label: t('groups.stat_expenses'), value: String(gastos), id: 'groups.expenseCount', minor: gastos },
            { label: t('groups.stat_owed_to_you'), value: formatMoney(owedToYou, cur), color: c.semantic.positive, id: 'groups.owedToYou', minor: owedToYou, code: cur },
            { label: t('groups.stat_you_owe'),     value: formatMoney(youOwe, cur),    color: c.textSecondary,     id: 'groups.youOwe',   minor: youOwe,    code: cur },
          ]}
        />

        {/* PO 2026-09-21: sin aire arriba (pegado a los casilleros) ni abajo
            (pegado al primer grupo). El selector ahora SÍ lleva su propia
            línea de abajo (`borde="abajo"`) — para que no se vea doble donde
            toca al primer grupo, el `Band` de la lista va con `noTop`. */}
        <View style={styles.segPad}>
          <Segmented
            variant="tabs"
            borde="abajo"
            value={tabActual}
            onChange={v => { hapticLight(); setTab(v); }}
            options={[
              { key: 'activos',     label: t('groups.tab_active'),   icon: 'folder-open-outline' },
              { key: 'archivados',  label: t('groups.tab_archived'), icon: 'archive-outline' },
            ]}
          />
        </View>

        {visibles.length === 0 ? (
          <EmptyState
            iconName={tabActual === 'archivados' ? 'archive-outline' : 'people-outline'}
            title={tabActual === 'archivados' ? t('groups.empty_archived_title') : t('groups.empty_title')}
            body={tabActual === 'archivados' ? t('groups.empty_archived_body') : t('groups.empty_body')}
          />
        ) : (
          <>
            <Band noTop>
              {visibles.map((g, i) => (
                <SwipeToArchive
                  key={g.id}
                  archived={tabActual === 'archivados'}
                  disabled={tabActual === 'archivados' && !canUnarchive(g.id)}
                  onAction={() => setArchived(g.id, tabActual === 'activos')}
                >
                  <GroupRow
                    group={g}
                    currentUserId={currentUser?.id ?? ''}
                    last={i === visibles.length - 1}
                    onPress={() => router.push(`/groups/${g.id}` as any)}
                  />
                </SwipeToArchive>
              ))}
            </Band>
            {/* La leyenda "deslizá para archivar" se sacó (PO 2026-09-22): con
                el "total total" pegado abajo, la banda de grupos y la del
                total tienen que leerse como UNA sola pieza, sin una leyenda
                de por medio separándolas. La de archivados sigue — informa
                algo real (no suman al balance), no es un tutorial de gesto. */}
            {tabActual === 'archivados' && (
              <Text style={[Typography.caption, styles.footnote, { color: c.textTertiary }]}>
                {t('groups.archived_hint')}
              </Text>
            )}

            {/* "Total total" (PO 2026-09-22): la sumatoria neta de los grupos
                QUE SE VEN AHORA — cuenta separada para activos y archivados,
                cambia con la pestaña. Distinto de los 4 casilleros de arriba,
                que son fijos. `noTop`: pegada a la banda de arriba, un solo
                borde entre las dos — no dos hairlines rozándose. */}
            <Band noTop>
              <View testID="groups-net-total" style={styles.netTotalRow}>
                <Text style={[Typography.label, styles.upper, { color: c.textTertiary }]}>
                  {t('groups.stat_net_total')}
                </Text>
                <MontoRodante
                  id="groups.netTotal"
                  minor={netTotal}
                  code={cur}
                  prefix={netTotal < 0 ? '-' : ''}
                  style={[
                    Typography.amountM,
                    { color: netTotal === 0 ? c.text : netTotal > 0 ? c.semantic.positive : c.semantic.negative },
                  ]}
                />
              </View>
            </Band>
          </>
        )}
      </Animated.ScrollView>

      <TabHeader title={t('groups.title')} progress={progress} />

      <FabRow>
        <Fab
          testID="new-group"
          onPress={() => { hapticLight(); router.push('/groups/new' as any); }}
          icon="add"
          label={t('groups.new_group')}
          backgroundColor={c.brand.primary}
        />
      </FabRow>
    </SafeAreaView>
  );
}

function GroupRow({
  group, currentUserId, onPress, last,
}: { group: Group; currentUserId: string; onPress: () => void; last?: boolean }) {
  const balances     = useGroupBalance(group.id, currentUserId);
  const expenseCount = useGroupExpenseCount(group.id);
  const mainBalance  = balances.find(b => b.currency === group.currency)?.amount ?? 0;

  return (
    <GroupCard
      name={group.name}
      memberIds={group.memberIds}
      balance={mainBalance}
      currency={group.currency}
      subtitle={`${expenseCount} gastos`}
      onPress={onPress}
      last={last}
      chevron
    />
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1 },
  // Sin padding lateral: las pestañas («T invertida») van de borde a borde.
  // Pegado a los 4 casilleros de arriba (PO 2026-09-20, revierte el aire de
  // T-108) y pegado al primer grupo abajo.
  segPad:   { paddingTop: 0, paddingBottom: 0 },
  footnote: { paddingHorizontal: Spacing.screenPad, paddingTop: 14, lineHeight: 17 },
  upper:    { textTransform: 'uppercase' },
  netTotalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingVertical: Spacing[4],
  },
});
