import { useState } from 'react';
import { useGroupStore } from '@/src/store/groupStore';
import { PERSONAL_ACTIVITY_KEY, type ActivityKind } from '@/src/store/selectors';
import { useUserStore } from '@/src/store/userStore';
import { searchActivity } from '@/src/algorithms/searchActivity';

export const ALL_FILTER = '__all__';

/** Filtro por grupo (T-116, orden fijo: Todos, Personal, y después cada grupo) + búsqueda de texto. */
export function useActivityFilter(feed: ActivityKind[]) {
  const groups = useGroupStore(s => s.groups);
  const { getUserName } = useUserStore();

  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState(ALL_FILTER);

  const allGroupNames = [
    ALL_FILTER, PERSONAL_ACTIVITY_KEY, ...groups.filter(g => !g.isDeleted).map(g => g.name),
  ];

  const porGrupo = activeFilter === ALL_FILTER
    ? feed
    : feed.filter(ev => ev.groupName === activeFilter);
  const filteredFeed = searchActivity(porGrupo, query, getUserName);

  return { query, setQuery, activeFilter, setActiveFilter, allGroupNames, filteredFeed };
}
