import type { ActivityKind } from '@/src/store/selectors';

/**
 * Quién hizo el movimiento y CUÁNDO llegó (no la fecha que eligió quien lo
 * cargó: un gasto de ayer cargado recién también es nuevo). `undefined` como
 * autor = no se sabe → no se puede asumir que fue otro, no cuenta.
 */
function autorYLlegada(ev: ActivityKind): { autor?: string; llegada: number } | null {
  switch (ev.kind) {
    case 'expense_added':    return { autor: ev.expense.createdById, llegada: ev.expense.createdAt };
    case 'payment_made':     return { autor: ev.payment.createdById, llegada: ev.payment.createdAt };
    case 'expense_deleted':  return { autor: ev.expense.deletedById, llegada: ev.expense.updatedAt };
    case 'expense_restored': return { autor: ev.expense.restoredById, llegada: ev.expense.updatedAt };
    // Los movimientos personales son siempre míos.
    case 'personal_entry':   return null;
  }
}

/**
 * «N sin ver» (PO 2026-09-29): movimientos de OTRAS personas que llegaron
 * después de `vistaHasta` (la última vez que salí de Actividad). Antes era
 * `todayEvents.length`: contaba lo propio y nunca bajaba.
 */
export function contarSinVer(
  eventos: ActivityKind[], vistaHasta: number, esMio: (userId?: string) => boolean,
): number {
  let n = 0;
  for (const ev of eventos) {
    const d = autorYLlegada(ev);
    if (!d || !d.autor || esMio(d.autor)) continue;
    if (d.llegada > vistaHasta) n++;
  }
  return n;
}
