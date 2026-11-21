/** Color de la categoría; las que no tienen uno propio (p. ej. `income`) usan el de «otro». */
export function tinteDeCategoria(paleta: Record<string, string>, id: string): string {
  return paleta[id] ?? paleta.other;
}
