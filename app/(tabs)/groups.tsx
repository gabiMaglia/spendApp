import React, { useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { useGroupBalance, useGroupExpenseCount, useGroupsTotalBalance } from '@/src/store/selectors';
import { Fab, FabRow } from '@/src/components/Fab';
import { useFx } from '@/src/store/useFx';
import { sumConverted } from '@/src/services/fxTotals';
import { GroupCard } from '@/src/components/GroupCard';
import { SwipeToArchive } from '@/src/components/SwipeToArchive';
import { EmptyState } from '@/src/components/EmptyState';
import { Band, Segmented, SplitStat } from '@/src/components/Band';
import { TabHeader } from '@/src/components/TabHeader';
import { useHeaderPadding } from '@/src/components/CollapsibleHeader';
import { hapticLight } from '@/src/utils/haptics';
import type { Group } from '@/src/types/models';

export default function GroupsScreen() {
  const { t } = useTranslation();
  const headerPad = useHeaderPadding();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { currentUser } = useAuthStore();
  const allGroups   = useGroupStore(s => s.groups);
  const archivedIds = useArchiveStore(s => s.archivedIds);
  const setArchived = useArchiveStore(s => s.setArchived);
  const groupTotals = useGroupsTotalBalance(currentUser?.id ?? '');

  const scrollY = useRef(new Animated.Value(0)).current;

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
    () => allGroups.filter(g => !g.isDeleted && (!currentUser || g.memberIds.includes(currentUser.id))),
    [allGroups, currentUser],
  );

  const [tabActual, setTab] = useState<'activos' | 'archivados'>('activos');

  const visibles = useMemo(
    () => myGroups.filter(g => archivedIds.includes(g.id) === (tabActual === 'archivados')),
    [myGroups, archivedIds, tabActual],
  );

  /** Los grupos activos. No depende de la pestaña, y eso es a propósito. */
  const activos = useMemo(
    () => myGroups.filter(g => !archivedIds.includes(g.id)).length,
    [myGroups, archivedIds],
  );

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: c.bg }]}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
        contentContainerStyle={{ paddingTop: headerPad, paddingBottom: 150 }}
      >
        <Text style={[Typography.display, styles.title, { color: c.text }]}>{t('groups.title')}</Text>

        {/* **Todo lo de arriba del segmentado no depende de la pestaña.**
            Antes este bloque estaba condicionado a que la lista tuviera items,
            así que al pasar a Archivados —normalmente vacío— desaparecía y el
            segmentado y la lista saltaban hacia arriba. Cambiar de pestaña tiene
            que cambiar sólo lo de abajo (pedido del PO).

            Por la misma razón el contador cuenta los grupos ACTIVOS y no los
            visibles: los saldos de al lado son globales y no se mueven, y un
            número que cambia al lado de dos que no, se lee como un error. */}
        <SplitStat
          items={[
            { label: t('groups.stat_owed_to_you'), value: formatMoney(owedToYou, cur), color: c.semantic.positive },
            { label: t('groups.stat_you_owe'),     value: formatMoney(youOwe, cur),    color: c.textSecondary },
            { label: t('groups.stat_groups'),      value: String(activos) },
          ]}
        />

        <View style={styles.segPad}>
          <Segmented
            value={tabActual}
            onChange={v => { hapticLight(); setTab(v); }}
            options={[
              { key: 'activos',     label: t('groups.tab_active') },
              { key: 'archivados',  label: t('groups.tab_archived') },
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
            <Band>
              {visibles.map((g, i) => (
                <SwipeToArchive
                  key={g.id}
                  archived={tabActual === 'archivados'}
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
            <Text style={[Typography.caption, styles.footnote, { color: c.textTertiary }]}>
              {tabActual === 'activos'
                ? t('groups.swipe_hint', { defaultValue: 'Deslizá un grupo a la izquierda para archivarlo.' })
                : t('groups.archived_hint', { defaultValue: 'Los grupos archivados no suman a los balances ni aparecen en Actividad.' })}
            </Text>
          </>
        )}
      </Animated.ScrollView>

      <TabHeader title={t('groups.title')} scrollY={scrollY} />

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
  title:    { paddingHorizontal: Spacing.screenPad, paddingBottom: 16 },
  segPad:   { paddingHorizontal: Spacing.screenPad, paddingTop: 16, paddingBottom: 14 },
  footnote: { paddingHorizontal: Spacing.screenPad, paddingTop: 14, lineHeight: 17 },
});
