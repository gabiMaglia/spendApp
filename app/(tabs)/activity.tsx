import React from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHeaderColapsable } from '@/src/hooks/useHeaderColapsable';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useActivityFeed } from '@/src/store/selectors';
import { TabHeader } from '@/src/components/TabHeader';
import { useHeaderPadding, useLimiteContenido } from '@/src/components/CollapsibleHeader';

import { useActivityFilter } from '@/src/screens/activity/hooks/useActivityFilter';
import { useActivitySections } from '@/src/screens/activity/hooks/useActivitySections';
import { useActivityTrust } from '@/src/screens/activity/hooks/useActivityTrust';
import { useRestoreExpense } from '@/src/screens/activity/hooks/useRestoreExpense';
import { ActivitySearchBar } from '@/src/screens/activity/components/ActivitySearchBar';
import { ActivityFilterTabs } from '@/src/screens/activity/components/ActivityFilterTabs';
import {
  buildActivityFlatItems, ActivityFeedItem, ActivityEmptyState, type ActivityFlatItem,
} from '@/src/screens/activity/components/ActivityFeedList';
import { useColors } from '@/src/skins/useSkin';
import { useContadorDeRenders } from '@/src/hooks/useContadorDeRenders';

// FlashList (T-154) no es un componente Animated por sí solo — este es el
// patrón estándar de la librería para engancharla al `useAnimatedScrollHandler`
// de Reanimated que ya usa `useHeaderColapsable`, sin tocar ese hook.
const AnimatedFlashList = Animated.createAnimatedComponent(FlashList<ActivityFlatItem>);

export default function ActivityScreen() {
  const { t } = useTranslation();
  // Pegado al header como en Grupos/Amigos (PO 2026-09-27): sin aire arriba.
  const headerPad = useHeaderPadding(0);
  const limiteContenido = useLimiteContenido();
  const c = useColors();
  const { currentUser } = useAuthStore();
  const getUserName = useUserStore(s => s.getUserName);
  const { scrollHandler, progress, contenidoMinimo, alMedirScroll } = useHeaderColapsable();

  const restaurar = useRestoreExpense(currentUser);
  const feed = useActivityFeed(currentUser?.id ?? '');

  const { query, setQuery, activeFilter, setActiveFilter, allGroupNames, filteredFeed } = useActivityFilter(feed);
  const { sections, todayNewCount } = useActivitySections(filteredFeed);
  const trustFor = useActivityTrust(filteredFeed);

  useContadorDeRenders('Actividad', {
    feedCount: feed.length, filteredCount: filteredFeed.length, activeFilter, query,
  });

  const feedIsEmpty = feed.length === 0;
  const filteredIsEmpty = feed.length > 0 && filteredFeed.length === 0;
  const items = filteredIsEmpty || feedIsEmpty
    ? []
    : buildActivityFlatItems(sections, t('activity.section_today'));

  // Sin 'bottom': la tab bar ya reserva el inset del sistema (_layout.tsx); contarlo acá dejaba una franja muerta entre el contenido y la barra.
  return (
    <SafeAreaView edges={[]} style={[styles.safe, { backgroundColor: c.bg }]}>
      <AnimatedFlashList
        style={limiteContenido}
        onLayout={alMedirScroll}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={scrollHandler}
        contentContainerStyle={[{ paddingBottom: 120, flexGrow: 1 }, contenidoMinimo]}
        data={items}
        keyExtractor={(it) => it.id}
        getItemType={(it) => it.kind}
        renderItem={({ item }) => (
          <ActivityFeedItem
            item={item}
            todayNewCount={todayNewCount}
            getUserName={getUserName}
            currentUserId={currentUser?.id ?? ''}
            onRestore={restaurar}
            trustFor={trustFor}
          />
        )}
        // T-219: el offset del header vive acá, no en contentContainerStyle —
        // FlashList v2 posiciona su canvas virtualizado (la primera fila,
        // "Hoy") midiendo dónde termina el ListHeaderComponent, no leyendo el
        // padding de la lista como hacía Animated.ScrollView antes de T-154.
        ListHeaderComponentStyle={{ paddingTop: headerPad }}
        ListHeaderComponent={
          <>
            <ActivityFilterTabs
              allGroupNames={allGroupNames}
              value={activeFilter}
              onChange={setActiveFilter}
            />

            {/* PO 2026-09-27: la búsqueda va debajo de las pestañas, no arriba. */}
            <ActivitySearchBar value={query} onChangeText={setQuery} />
          </>
        }
        ListEmptyComponent={
          <ActivityEmptyState feedIsEmpty={feedIsEmpty} activeFilter={activeFilter} />
        }
      />

      <TabHeader title={t('activity.title')} progress={progress} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
});
