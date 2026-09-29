import { useEffect, useMemo, useRef } from 'react';

import type { CurrencyCode } from '@/src/constants/currencies';
import { acreedoresDe, totalAdeudado } from '@/src/algorithms/repartoSaldo';
import { suggestedSettlement } from '@/src/algorithms/settleSuggestion';
import type { Balance, Expense, Group, Payment } from '@/src/types/models';
import { balancesEnMoneda } from '@/src/screens/settle/saldoDeGrupo';

/**
 * Cuánto se debe en el grupo elegido y entre el par elegido, y el autollenado
 * del monto al cambiar de par. T-223: salió de `app/settle/new.tsx`.
 */
export function useDeudaDelPar({
  group, allExpenses, allPayments, currency, groupId, fromId, toId, currentUserId, setAmountMinor,
}: {
  group: Group | undefined;
  allExpenses: Expense[];
  allPayments: Payment[];
  currency: CurrencyCode;
  groupId: string;
  fromId: string;
  toId: string;
  currentUserId: string;
  setAmountMinor: (minor: number) => void;
}) {
  const balancesDelGrupo = useMemo<Balance[]>(
    () => balancesEnMoneda(group, allExpenses, allPayments, currency),
    [group, allExpenses, allPayments, currency],
  );

  /**
   * Cuánto haría falta para saldar entre estas dos personas. Acotado por los
   * dos lados: pagar de más movería la deuda en vez de saldarla.
   */
  const deudaTotal = useMemo(
    () => suggestedSettlement(balancesDelGrupo, fromId, toId),
    [balancesDelGrupo, fromId, toId],
  );

  const todoSaldado = balancesDelGrupo.length > 0 && balancesDelGrupo.every(b => b.amount === 0);

  /**
   * El monto llega YA PUESTO al elegir a la persona, como en Splitwise: saldar
   * completo es el caso normal y tipearlo a mano deja restos de un peso. Sigue
   * siendo editable — un pago parcial es sólo escribir otro número encima.
   *
   * Se rellena al CAMBIAR de par, no en cada render: si no, pisaría lo que el
   * usuario está escribiendo.
   */
  const ultimoPar = useRef('');
  useEffect(() => {
    const par = `${groupId}|${fromId}|${toId}|${currency}`;
    if (par === ultimoPar.current) return;
    ultimoPar.current = par;
    setAmountMinor(deudaTotal);
  }, [groupId, fromId, toId, currency, deudaTotal, setAmountMinor]);

  /**
   * El techo real: lo que se debe EN ESTE grupo, nunca más.
   *
   * Antes se validaba contra `maxAmount`, que viniendo de Contactos es el neto
   * GLOBAL entre las dos personas. El monto hablaba de todos los grupos y el
   * pago se registraba en uno solo: así se corrompieron los saldos del PO
   * (T-051). Ahora monto y alcance hablan de lo mismo.
   */
  /**
   * A quiénes les debo en ESTE grupo (ADR-006, decisión 2).
   *
   * Con más de un acreedor, saldar de a uno obliga a repetir la operación
   * tantas veces como personas — y a acordarse de todas. El modo "todo" las
   * cubre de una.
   */
  const acreedores = useMemo(
    () => acreedoresDe(balancesDelGrupo, currentUserId),
    [balancesDelGrupo, currentUserId],
  );
  const deudaEnGrupo = totalAdeudado(acreedores);

  return { balancesDelGrupo, deudaTotal, todoSaldado, acreedores, deudaEnGrupo };
}
