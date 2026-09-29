import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHeaderColapsable } from '@/src/hooks/useHeaderColapsable';
import { useRellenoBarraPestanas } from '@/src/hooks/useRellenoBarraPestanas';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

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
import {
  buildGroupsFlatItems, GroupsList, type GroupsFlatItem,
} from '@/src/screens/groups/components/GroupsList';
import { GroupsNetTotal } from '@/src/screens/groups/components/GroupsNetTotal';
import { useColors } from '@/src/skins/useSkin';
import { useContadorDeRenders } from '@/src/hooks/useContadorDeRenders';

// Mismo patrón que Actividad (T-154): FlashList no es Animated por sí sola,
// se envuelve para seguir enganchada a `useHeaderColapsable` (Reanimated).
const AnimatedFlashList = Animated.createAnimatedComponent(FlashList<GroupsFlatItem>);

export default function GroupsScreen() {
  const { t } = useTranslation();
  // Sin aire entre el header y el primer elemento (PO 2026-09-13, T-130).
  const headerPad = useHeaderPadding(0);
  const limiteContenido = useLimiteContenido();
  const c = useColors();

  const { scrollHandler, progress, contenidoMinimo, alMedirScroll } = useHeaderColapsable();
  // Aero: la barra flota sobre el contenido; su alto queda libre abajo (T-227).
  const barra = useRellenoBarraPestanas();

  const {
    currentUser, tabActual, setTab, visibles, visibleGroupIds, idsActivos, gastos,
    canUnarchive, handleOpenGroup, handleArchiveAction,
  } = useGroupsList();
  const { cur, fx, owedToYou, youOwe } = useGroupsBalances(currentUser?.id ?? '');
  const netTotal = useGroupsNetTotal(
    currentUser?.id ?? '',
    visibleGroupIds,
    cur, fx,
  );

  useContadorDeRenders('Grupos', { visiblesCount: visibles.length, tabActual, owedToYou, youOwe });

  const items = buildGroupsFlatItems(visibles);

  // Sin 'bottom': la tab bar ya reserva el inset del sistema (_layout.tsx); contarlo acá dejaba una franja muerta entre el contenido y la barra.
  return (
    <SafeAreaView edges={[]} style={[styles.safe, { backgroundColor: c.bg }]}>
      {/* T-219b: el margen bajo la barra (`useLimiteContenido`) va en ESTE View,
          nunca en el `style` del AnimatedFlashList — Reanimated le pasa `style`
          como array y FlashList v2 lo mezcla con spread de objeto: el margen se pierde. */}
      <View style={[styles.lista, limiteContenido]}>
        <AnimatedFlashList
          onLayout={alMedirScroll}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={scrollHandler}
          contentContainerStyle={[{ paddingBottom: 150 + barra, flexGrow: 1 }, contenidoMinimo]}
          data={items}
          keyExtractor={(it) => it.id}
          getItemType={(it) => it.kind}
          renderItem={() => (
            <GroupsList
              groups={visibles}
              tab={tabActual}
              currentUserId={currentUser?.id ?? ''}
              canUnarchive={canUnarchive}
              onOpenGroup={handleOpenGroup}
              onArchiveAction={handleArchiveAction}
            />
          )}
          // T-219: el offset del header vive acá, no en contentContainerStyle —
          // FlashList v2 mide dónde termina el ListHeaderComponent para
          // posicionar el resto, no lee el padding de la lista como hacía
          // Animated.ScrollView antes de T-154 (sin esto, el header tapaba la
          // mitad de arriba de GroupsSummaryStats, el primer bloque).
          ListHeaderComponentStyle={{ paddingTop: headerPad }}
          ListHeaderComponent={
            <>
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
            </>
          }
          ListEmptyComponent={
            <EmptyState
              iconName={tabActual === 'archivados' ? 'archive-outline' : 'people-outline'}
              title={tabActual === 'archivados' ? t('groups.empty_archived_title') : t('groups.empty_title')}
              body={tabActual === 'archivados' ? t('groups.empty_archived_body') : t('groups.empty_body')}
            />
          }
          ListFooterComponent={
            visibles.length > 0 ? <GroupsNetTotal netTotal={netTotal} cur={cur} /> : undefined
          }
        />
      </View>

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
  lista: { flex: 1 },
});
