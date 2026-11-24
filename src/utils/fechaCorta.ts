import i18n from '@/src/i18n';

/** «Hoy» / «Ayer» (i18n) o día y mes cortos en el idioma activo. Unifica los dos formatDate de T-288. */
export function fechaCorta(d: Date): string {
  const today     = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const dMid      = new Date(d);    dMid.setHours(0, 0, 0, 0);
  if (dMid.getTime() === today.getTime())     return i18n.t('common.today');
  if (dMid.getTime() === yesterday.getTime()) return i18n.t('common.yesterday');
  return d.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
}
