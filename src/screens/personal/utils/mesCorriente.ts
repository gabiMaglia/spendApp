/**
 * ¿La fecha cae en el mes en curso? (PO 2026-11-04, T-257)
 *
 * Sólo se edita una entrada personal del mes corriente: un mes cerrado ya
 * arrastró su saldo y editarlo lo dejaría desactualizado.
 */
export function esDelMesCorriente(fecha: number, ahora: Date = new Date()): boolean {
  const d = new Date(fecha);
  return d.getFullYear() === ahora.getFullYear() && d.getMonth() === ahora.getMonth();
}
