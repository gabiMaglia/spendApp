import React from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHeaderColapsable } from '@/src/hooks/useHeaderColapsable';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useActivityFeed } from '@/src/store/selectors';
import { TabHeader } from '@/src/components/TabHeader';
import { useHeaderPadding, useLimiteContenido } from '@/src/components/CollapsibleHeader';
import { syncedNow } from '@/src/utils/syncedClock';

import { useActivityFilter } from '@/src/screens/activity/hooks/useActivityFilter';
import { useActivitySections } from '@/src/screens/activity/hooks/useActivitySections';
import { useActivityTrust } from '@/src/screens/activity/hooks/useActivityTrust';
import { useRestoreExpense } from '@/src/screens/activity/hooks/useRestoreExpense';
import { ActivitySearchBar } from '@/src/screens/activity/components/ActivitySearchBar';
import { ActivityFilterTabs } from '@/src/screens/activity/components/ActivityFilterTabs';
import { ActivityFeedList } from '@/src/screens/activity/components/ActivityFeedList';

export default function ActivityScreen() {
  const { t } = useTranslation();
  const headerPad = useHeaderPadding();
  const limiteContenido = useLimiteContenido();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { currentUser } = useAuthStore();
  const { getUserName } = useUserStore();
  const { scrollHandler, progress, contenidoMinimo, alMedirScroll } = useHeaderColapsable();

  const restaurar = useRestoreExpense(currentUser);
  const feed = useActivityFeed(currentUser?.id ?? '');
  const ahora = syncedNow();

  const { query, setQuery, activeFilter, setActiveFilter, allGroupNames, filteredFeed } = useActivityFilter(feed);
  const { sections, todayNewCount } = useActivitySections(filteredFeed);
  const trustFor = useActivityTrust(filteredFeed, ahora);

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: c.bg }]}>
      <Animated.ScrollView
        style={limiteContenido}
        onLayout={alMedirScroll}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={scrollHandler}
        contentContainerStyle={[{ paddingTop: headerPad, paddingBottom: 120, flexGrow: 1 }, contenidoMinimo]}
      >
        <ActivitySearchBar value={query} onChangeText={setQuery} />

        <ActivityFilterTabs
          allGroupNames={allGroupNames}
          value={activeFilter}
          onChange={setActiveFilter}
        />

        <ActivityFeedList
          feedIsEmpty={feed.length === 0}
          filteredIsEmpty={feed.length > 0 && filteredFeed.length === 0}
          activeFilter={activeFilter}
          sections={sections}
          todayNewCount={todayNewCount}
          getUserName={getUserName}
          currentUserId={currentUser?.id ?? ''}
          onRestore={restaurar}
          trustFor={trustFor}
        />
      </Animated.ScrollView>

      <TabHeader title={t('activity.title')} progress={progress} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
});
