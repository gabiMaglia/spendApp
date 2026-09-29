import { useEffect, useMemo, useRef } from 'react';

import type { CurrencyCode } from '@/src/constants/currencies';
import { totalAdeudado } from '@/src/algorithms/repartoSaldo';
import { deudasDelGrupo, deudaEntre } from '@/src/algorithms/deudasDelGrupo';
import { acreedoresSinCompensar } from '@/src/algorithms/saldoSinCompensar';
import { pagosQueCuentan } from '@/src/algorithms/settlementStatus';
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

  // T-225 (PO 2026-09-29): la deuda por par SIN compensar. Si le debo 60 a Ana
  // y ella me debe 200, saldar con ella son mis 60 — el neto decía 0.
  const deudas = useMemo(
    () => group
      ? deudasDelGrupo(allExpenses.filter(e => e.groupId === group.id), pagosQueCuentan(allPayments, group), group.memberIds)
      : [],
    [group, allExpenses, allPayments],
  );

  /** Lo que `fromId` le debe a `toId` en este grupo: el sugerido y el máximo. */
  const deudaTotal = useMemo(
    () => deudaEntre(deudas, fromId, toId, currency),
    [deudas, fromId, toId, currency],
  );

  // Con una sola deuda viva, en cualquier dirección, no está «todo saldado».
  const todoSaldado = group !== undefined && deudas.length === 0;

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
    () => acreedoresSinCompensar(deudas, currentUserId, currency),
    [deudas, currentUserId, currency],
  );
  const deudaEnGrupo = totalAdeudado(acreedores);

  return { balancesDelGrupo, deudaTotal, todoSaldado, acreedores, deudaEnGrupo };
}
