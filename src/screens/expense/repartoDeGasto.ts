import type { Ionicons } from '@expo/vector-icons';
import type React from 'react';

import { buildSplits } from '@/src/algorithms/buildSplits';
import { splitsPorPorcentajes } from '@/src/algorithms/recurringSplits';
import type { Expense, PersonalCategory } from '@/src/types/models';

/**
 * Lógica pura de Nuevo gasto (T-223: salió de `app/expense/new.tsx`).
 */

export type SplitMode  = 'equal' | 'percentage';
export type PercentSub = 'same'  | 'custom';

type CatMeta = { id: PersonalCategory; icon: React.ComponentProps<typeof Ionicons>['name']; label: string };

export const CATEGORIES: CatMeta[] = [
  { id: 'food',          icon: 'restaurant-outline',          label: 'Comida'        },
  { id: 'transport',     icon: 'car-outline',                 label: 'Transporte'    },
  { id: 'accommodation', icon: 'home-outline',                label: 'Alojamiento'   },
  { id: 'entertainment', icon: 'game-controller-outline',     label: 'Ocio'          },
  { id: 'utilities',     icon: 'flash-outline',               label: 'Servicios'     },
  { id: 'taxes',         icon: 'document-text-outline',       label: 'Impuestos'     },
  { id: 'health',        icon: 'medical-outline',             label: 'Salud'         },
  { id: 'shopping',      icon: 'bag-outline',                 label: 'Compras'       },
  { id: 'other',         icon: 'ellipsis-horizontal-outline', label: 'Otro'          },
];

// Redondeo de PORCENTAJES para mostrar en UI (no es un monto — ADR-002 no
// aplica acá; los splits reales se calculan en enteros vía buildSplits).
export function roundPct(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatDate(d: Date): string {
  const today     = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const dMid      = new Date(d);    dMid.setHours(0, 0, 0, 0);
  if (dMid.getTime() === today.getTime())     return 'Hoy';
  if (dMid.getTime() === yesterday.getTime()) return 'Ayer';
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

export type EstadoPorcentajes = {
  splitMode: SplitMode;
  percentSub: PercentSub;
  samePercent: string;
  customPercents: string[];
};

/**
 * **El % que tipeo es el mío** (PO 2026-11-06). El reparto por porcentaje le
 * da el % tipeado a todos menos al último, que recibe el resto; con la lista
 * en el orden del grupo, quien quedaba al fondo cargaba un 60% y se llevaba
 * el 40. Quien carga el gasto va primero; los demás conservan su orden.
 */
export function miembrosDelReparto(miembros: string[], esYo: (uid: string) => boolean): string[] {
  const yo = miembros.filter(esYo);
  return yo.length === 0 ? miembros : [...yo, ...miembros.filter(uid => !esYo(uid))];
}

/**
 * Estado inicial del reparto al EDITAR: reconstruye los % desde los splits
 * guardados, POR PERSONA en el orden de `members` (el orden del reparto de
 * quien edita, que no tiene por qué ser el de quien lo guardó). Sin
 * `members`, el orden de los splits guardados.
 */
export function estadoInicialPorcentajes(gasto: Expense | undefined, members?: string[]): EstadoPorcentajes {
  if (!gasto || gasto.splitMode !== 'percentage' || gasto.amount <= 0) {
    return { splitMode: 'equal', percentSub: 'same', samePercent: '', customPercents: [] };
  }
  const { amount, splits } = gasto;
  const orden = members && members.length > 0 ? members : splits.map(s => s.userId);
  const montoDe = (uid: string) => splits.find(s => s.userId === uid)?.amount ?? 0;
  const pctDe = (uid: string | undefined) => (uid ? roundPct((montoDe(uid) / amount) * 100) : 0);
  const firstPct = pctDe(orden[0]);
  const percents = orden.slice(0, -1).map(uid => String(pctDe(uid)));
  const allEqual = percents.every(p => parseFloat(p) === firstPct);
  return {
    splitMode: 'percentage',
    percentSub: allEqual ? 'same' : 'custom',
    samePercent: String(firstPct),
    customPercents: percents,
  };
}

export type SplitCalculado = { userId: string; amount: number; percent: number; isLast: boolean };

/**
 * Reparto del gasto. Todos los montos son ENTEROS en menor unidad (ADR-002),
 * vía `buildSplits` — única fuente de verdad, para que Σ splits === total
 * EXACTO y sea reproducible entre dispositivos.
 */
export function calcularSplits(p: {
  amount: number;
  members: string[];
  splitMode: SplitMode;
  percentSub: PercentSub;
  samePercent: string;
  customPercents: string[];
}): SplitCalculado[] {
  const { amount, members, splitMode, percentSub, samePercent, customPercents } = p;
  if (members.length === 0) return [];

  if (splitMode === 'equal') {
    const built = buildSplits(amount, members, 'equal');
    const evenPercent = roundPct(100 / members.length);
    return built.map((s, i) => ({ ...s, percent: evenPercent, isLast: i === built.length - 1 }));
  }

  // El usuario tipea el % de todos menos el último, que recibe el resto
  // (100 - Σ). Los montos de los "no-últimos" se redondean desde su %; el
  // último se calcula con buildSplits('custom') para que cierre EXACTO contra
  // el total (nunca deriva por acumulación de redondeo).
  const firstPercents = members.slice(0, -1).map((_, i) =>
    percentSub === 'same'
      ? parseFloat(samePercent.replace(',', '.')) || 0
      : parseFloat(customPercents[i]?.replace(',', '.') ?? '') || 0,
  );
  const sumFirst    = firstPercents.reduce((a, b) => a + b, 0);
  const lastPercent = roundPct(100 - sumFirst);

  const built = splitsPorPorcentajes(amount, members, firstPercents);
  return built.map((s, i) => {
    const isLast = i === built.length - 1;
    return { ...s, percent: isLast ? lastPercent : (firstPercents[i] ?? 0), isLast };
  });
}
