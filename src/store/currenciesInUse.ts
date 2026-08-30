import { useMemo } from 'react';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useExpenseStore } from './expenseStore';
import { usePaymentStore } from './paymentStore';
import { usePersonalStore } from './personalStore';

/**
 * Las monedas que el usuario realmente usa.
 *
 * Alimenta la decisión del PO de no pedir cotizaciones cuando hay una sola
 * moneda en juego: sin esto habría que salir a la red para descubrir que no
 * hacía falta. Ignora lo borrado — un gasto en una moneda que ya no existe no
 * puede obligar a una llamada.
 */
export function useCurrenciesInUse(): CurrencyCode[] {
  const expenses = useExpenseStore(s => s.expenses);
  const payments = usePaymentStore(s => s.payments);
  const entries  = usePersonalStore(s => s.entries);

  return useMemo(() => {
    const vistas = new Set<CurrencyCode>();
    for (const e of expenses) if (!e.isDeleted) vistas.add(e.currency);
    for (const p of payments) if (!p.isDeleted) vistas.add(p.currency);
    for (const n of entries)  if (!n.isDeleted) vistas.add(n.currency);
    return Array.from(vistas);
  }, [expenses, payments, entries]);
}
