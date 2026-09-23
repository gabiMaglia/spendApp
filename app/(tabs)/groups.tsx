import React from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHeaderColapsable } from '@/src/hooks/useHeaderColapsable';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Fab, FabRow } from '@/src/components/Fab';
import { EmptyState } from '@/src/components/EmptyState';
import { TabHeader } from '@/src/components/TabHeader';
import { useHeaderPadding, useLimiteContenido } from '@/src/components/CollapsibleHeader';
import { hapticLight } from '@/src/utils/haptics';

import { useGroupsBalances } from '@/src/screens/groups/hooks/useGroupsBalances';
import { useGroupsList } from '@/src/screens/groups/hooks/useGroupsList';
import { useGroupsNetTotal } from '@/src/screens/groups/hooks/useGroupsNetTotal';
import { GroupsSummaryStats } from '@/src/screens/groups/components/GroupsSummaryStats';
import { GroupsTabSelector } from '@/src/screens/groups/components/GroupsTabSelector';
import { GroupsList } from '@/src/screens/groups/components/GroupsList';
import { GroupsNetTotal } from '@/src/screens/groups/components/GroupsNetTotal';

export default function GroupsScreen() {
  const { t } = useTranslation();
  // Sin aire entre el header y el primer elemento (PO 2026-09-13, T-130).
  const headerPad = useHeaderPadding(0);
  const limiteContenido = useLimiteContenido();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { scrollHandler, progress, contenidoMinimo, alMedirScroll } = useHeaderColapsable();

  const {
    currentUser, tabActual, setTab, visibles, idsActivos, gastos,
    canUnarchive, handleOpenGroup, handleArchiveAction,
  } = useGroupsList();
  const { cur, fx, owedToYou, youOwe } = useGroupsBalances(currentUser?.id ?? '');
  const netTotal = useGroupsNetTotal(
    currentUser?.id ?? '',
    visibles.map(g => g.id),
    cur, fx,
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
            Cambiar de pestaña tiene que cambiar sólo lo de abajo (pedido del
            PO) — por eso el contador cuenta los grupos ACTIVOS, no los
            visibles: los saldos de al lado son globales y no se mueven. */}
        <GroupsSummaryStats
          activeGroupCount={idsActivos.size}
          expenseCount={gastos}
          owedToYou={owedToYou}
          youOwe={youOwe}
          cur={cur}
        />

        <GroupsTabSelector value={tabActual} onChange={setTab} />

        {visibles.length === 0 ? (
          <EmptyState
            iconName={tabActual === 'archivados' ? 'archive-outline' : 'people-outline'}
            title={tabActual === 'archivados' ? t('groups.empty_archived_title') : t('groups.empty_title')}
            body={tabActual === 'archivados' ? t('groups.empty_archived_body') : t('groups.empty_body')}
          />
        ) : (
          <>
            <GroupsList
              groups={visibles}
              tab={tabActual}
              currentUserId={currentUser?.id ?? ''}
              canUnarchive={canUnarchive}
              onOpenGroup={handleOpenGroup}
              onArchiveAction={handleArchiveAction}
            />
            <GroupsNetTotal netTotal={netTotal} cur={cur} />
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

const styles = StyleSheet.create({
  safe: { flex: 1 },
});
