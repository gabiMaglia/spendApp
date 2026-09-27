import type { Group, Payment } from '@/src/types/models';

/**
 * **Qué pagos cuentan para el balance** (T-186: sin acuse).
 *
 * Hasta T-064 esto derivaba un estado (`efectivo`/`pendiente`/`rechazado`)
 * contra los acuses de quien cobra, porque en un grupo `consensus` declarar
 * que pagaste no saldaba solo. T-186 sacó el modo «con acuerdo» de cuajo —
 * ver `docs/CONSENSO-PENDIENTE.md` — así que un pago declarado por el deudor
 * cuenta al instante: no hay acuse que esperar ni rechazo que revertirlo.
 *
 * Lo único que sigue filtrando un pago es el tombstone (`isDeleted`), igual
 * que cualquier otro registro.
 *
 * **Existe como función única y no como un `.filter()` en cada pantalla.** Los
 * seis lugares que calculaban balances repetían `payments.filter(p => p.groupId
 * === g.id)` a mano, y esa forma —la misma lista mantenida en varios lados— es
 * la que produjo T-055, T-057 y T-060. `__tests__/settlementStatus.test.ts`
 * escanea el árbol para que no vuelva a aparecer suelta.
 */
export function pagosQueCuentan(
  payments: readonly Payment[], group: Group | undefined,
): Payment[] {
  if (!group) return [];
  return payments.filter(p => p.groupId === group.id && !p.isDeleted);
}
