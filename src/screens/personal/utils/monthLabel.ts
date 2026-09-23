import i18n from '@/src/i18n';
import { toMonthKey } from '@/src/store/personalStore';

/** "2026-09" → "Septiembre de 2026" (según idioma activo), primera letra en mayúscula. */
export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const d = new Date(year, month - 1, 1);
  const s = d.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function prevMonth(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const d = new Date(year, month - 2, 1);
  return toMonthKey(d.getTime());
}

export function nextMonth(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const d = new Date(year, month, 1);
  return toMonthKey(d.getTime());
}
