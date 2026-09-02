import { hasSettledUp, unsettledCurrencies, type BalanceEntry } from './absorbBalance';
import type { CurrencyCode } from '@/src/constants/currencies';

/**
 * ¿Puede irse del grupo, y bajo qué condiciones?
 *
 * Regla del PO: se sale libremente sólo si no hay cuentas abiertas. Con saldo
 * pendiente hace falta que **todos** aprueben y decidir quién absorbe.
 *
 * El caso "soy el último" se trata aparte porque no tiene solución: no queda
 * nadie a quien pasarle el saldo. Ofrecer "salir" ahí sería mentir.
 */

export type LeaveVerdict =
  /** Sin deudas: se va y listo. */
  | { kind: 'free' }
  /** Hay saldo abierto: hace falta absorción + aprobación de todos. */
  | { kind: 'needs_absorption'; currencies: CurrencyCode[]; approversNeeded: string[] }
  /** Último miembro con saldo: no hay a quién pasarle nada. */
  | { kind: 'last_member_with_balance'; currencies: CurrencyCode[] };

export function canLeaveGroup(
  balances: BalanceEntry[],
  otherMemberIds: string[],
): LeaveVerdict {
  if (hasSettledUp(balances)) return { kind: 'free' };

  const currencies = unsettledCurrencies(balances);
  if (otherMemberIds.length === 0) return { kind: 'last_member_with_balance', currencies };

  return { kind: 'needs_absorption', currencies, approversNeeded: otherMemberIds };
}

