import type { CurrencyCode } from '@/src/constants/currencies';
import type { DeudaPar } from '@/src/algorithms/deudasDelGrupo';
import { idCanonico } from '@/src/store/identityAlias';

/**
 * **Nadie sale con deuda viva** (T-228, PO 2026-09-29, auditoría H-1).
 *
 * `deudasDelGrupo` descarta las deudas con quien ya no está en el roster; el
 * neto no. Si alguien saliera con una deuda pendiente, el grupo quedaría con
 * «Te deben 0 · Debés 0» arriba y un balance distinto de cero abajo, sin forma
 * de cobrarlo. Por eso salir, expulsar y la salida automática al borrar la
 * cuenta exigen que no haya NINGUNA deuda en NINGUNA dirección, como Splitwise
 * y Tricount.
 */
export function deudasDe(deudas: readonly DeudaPar[], userId: string): DeudaPar[] {
  const yo = idCanonico(userId);
  return deudas.filter(d => d.deudor === yo || d.acreedor === yo);
}

export function tieneDeudaViva(deudas: readonly DeudaPar[], userId: string): boolean {
  return deudasDe(deudas, userId).length > 0;
}

export function monedasConDeuda(deudas: readonly DeudaPar[], userId: string): CurrencyCode[] {
  return [...new Set(deudasDe(deudas, userId).map(d => d.currency))];
}
