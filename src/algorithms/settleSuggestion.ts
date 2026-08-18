import type { Balance } from '@/src/types/models';

/**
 * Cuánto tiene sentido que una persona le pague a otra para saldar.
 *
 * La respuesta NO es "todo lo que debe": está acotada por los dos lados.
 * Si Ana debe 5.000 pero a Beto sólo le deben 3.000, pagarle 5.000 lo dejaría
 * a Beto en +2.000 — se habría mudado la deuda en vez de saldarla, y encima
 * contra alguien que no tenía nada que ver.
 *
 *     sugerido = min(lo que debe el que paga, lo que le deben al que cobra)
 *
 * Es exactamente el mismo cálculo que hace `simplifyDebts` al emparejar, pero
 * para un par que elige el usuario en vez del que elige el algoritmo.
 *
 * Devuelve 0 —y no un negativo ni una excepción— cuando el par no tiene sentido
 * (el que paga no debe nada, o al que cobra no le deben nada). La pantalla usa
 * ese 0 para no ofrecer el botón: no hay nada que autocompletar.
 *
 * Enteros en menor unidad (ADR-002), aritmética exacta.
 */
export function suggestedSettlement(
  balances: Balance[],
  fromUserId: string,
  toUserId: string,
): number {
  const debe    = balances.find(b => b.userId === fromUserId)?.amount ?? 0;
  const leDeben = balances.find(b => b.userId === toUserId)?.amount ?? 0;

  // El que paga tiene que estar en rojo y el que cobra en verde. Esto cubre
  // también el caso de pagarse a uno mismo: un balance no puede ser negativo y
  // positivo a la vez, así que la misma persona nunca pasa los dos chequeos.
  if (debe >= 0 || leDeben <= 0) return 0;

  return Math.min(Math.abs(debe), leDeben);
}
