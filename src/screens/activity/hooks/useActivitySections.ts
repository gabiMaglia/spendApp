import { useTranslation } from 'react-i18next';
import type { ActivityKind } from '@/src/store/selectors';
import { getTs } from '@/src/screens/activity/utils/activityFormat';

export type ActivitySection = { label: string; events: ActivityKind[] };

/** Agrupa el feed ya filtrado en Hoy/Ayer/Antes, salteando secciones vacías. */
export function useActivitySections(filteredFeed: ActivityKind[]) {
  const { t } = useTranslation();

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  const todayEvents     = filteredFeed.filter(ev => getTs(ev) >= todayStart.getTime());
  const yesterdayEvents = filteredFeed.filter(ev => getTs(ev) >= yesterdayStart.getTime() && getTs(ev) < todayStart.getTime());
  const olderEvents     = filteredFeed.filter(ev => getTs(ev) < yesterdayStart.getTime());

  const sections: ActivitySection[] = [];
  if (todayEvents.length)     sections.push({ label: t('activity.section_today'),     events: todayEvents });
  if (yesterdayEvents.length) sections.push({ label: t('activity.section_yesterday'), events: yesterdayEvents });
  if (olderEvents.length)     sections.push({ label: t('activity.section_older'),     events: olderEvents });

  return { sections, todayNewCount: todayEvents.length };
}
