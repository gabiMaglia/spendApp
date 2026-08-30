/**
 * Cuánto se puede saldar de verdad en la pantalla de saldar.
 *
 * Existe por un bug con repro real (T-051): saldando desde Contactos, el monto
 * ofrecido era el **neto global** entre dos personas —sumando todos los
 * grupos— mientras que el pago se registraba contra **un solo grupo**. Un pago
 * que cubría deudas de dos grupos entraba entero en uno: globalmente cerraba,
 * y los dos grupos quedaban con saldos que nadie generó.
 *
 * La regla acá es que el monto y el alcance tienen que hablar de lo mismo: se
 * salda, como mucho, **lo que se debe en el grupo que se está saldando**.
 *
 * Esto NO es el modelo final. El PO definió que saldar debe ser direccional
 * (saldar lo mío no compensa lo que me deben) y que un saldo desde Contactos
 * debería repartirse entre los grupos donde la deuda existe. Eso cambia qué
 * significa un balance y corresponde ADR. Mientras tanto, esto impide que se
 * sigan corrompiendo saldos.
 */
export function topeDelSaldo(
  /** Lo que hace falta para saldar entre estas dos personas EN ESTE grupo. */
  deudaDelGrupo: number,
  /** El máximo que traía la pantalla que nos abrió, si traía alguno. */
  topeExterno: number | undefined,
): number {
  // Sin deuda en este grupo no hay nada que saldar acá, venga el número que
  // venga de afuera. Antes esto permitía volcar un saldo ajeno en un grupo
  // que no lo debía.
  if (deudaDelGrupo <= 0) return 0;
  if (topeExterno === undefined) return deudaDelGrupo;
  return Math.min(deudaDelGrupo, topeExterno);
}

/** ¿El monto tipeado se pasa de lo que se puede saldar acá? */
export function excedeElTope(monto: number, tope: number): boolean {
  return monto > tope;
}
