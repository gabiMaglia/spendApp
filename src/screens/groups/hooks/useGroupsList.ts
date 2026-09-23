import { useCallback, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { esYo } from '@/src/store/identityAlias';

export type GroupsTab = 'activos' | 'archivados';

/**
 * Grupos del usuario, filtrados por pestaña (activos/archivados), más los
 * dos contadores que NO dependen de la pestaña (grupos activos, gastos
 * vivos) — describen "tu situación", no la lista que estás mirando.
 */
export function useGroupsList() {
  const { currentUser } = useAuthStore();
  const allGroups   = useGroupStore(s => s.groups);
  const archivedIds = useArchiveStore(s => s.archivedIds);
  const setArchived = useArchiveStore(s => s.setArchived);
  const canUnarchive = useArchiveStore(s => s.canUnarchive);

  const myGroups = useMemo(
    () => allGroups.filter(g => !g.isDeleted && (!currentUser || g.memberIds.some(esYo))),
    [allGroups, currentUser],
  );

  const [tabActual, setTab] = useState<GroupsTab>('activos');

  const visibles = useMemo(
    () => myGroups.filter(g => archivedIds.includes(g.id) === (tabActual === 'archivados')),
    [myGroups, archivedIds, tabActual],
  );

  /** Los grupos activos. No depende de la pestaña, y eso es a propósito. */
  const idsActivos = useMemo(
    () => new Set(myGroups.filter(g => !archivedIds.includes(g.id)).map(g => g.id)),
    [myGroups, archivedIds],
  );

  /**
   * Gastos vivos de los grupos activos. Como los otros tres indicadores, no
   * depende de la pestaña: los cuatro describen tu situación, no la lista
   * que estás mirando.
   */
  const gastos = useExpenseStore(
    s => s.expenses.filter(e => !e.isDeleted && idsActivos.has(e.groupId)).length,
  );

  // Callbacks ESTABLES (PO 2026-09-22, rendimiento en gama baja): antes eran
  // arrow functions inline dentro del `.map()`, así que cada fila recibía una
  // referencia NUEVA en cada render de la pantalla — con `GroupRow`
  // memoizado, una prop que "cambia" siempre anula el memo por completo.
  const handleOpenGroup = useCallback((id: string) => {
    router.push(`/groups/${id}` as any);
  }, []);
  const handleArchiveAction = useCallback((id: string) => {
    setArchived(id, tabActual === 'activos');
  }, [setArchived, tabActual]);

  return {
    currentUser, myGroups, tabActual, setTab, visibles, idsActivos, gastos,
    canUnarchive, handleOpenGroup, handleArchiveAction,
  };
}
