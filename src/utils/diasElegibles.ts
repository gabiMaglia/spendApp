/** Los últimos 7 días, a mediodía; con `soloMesCorriente`, sin salir del mes. */
export function diasElegibles(soloMesCorriente: boolean, ahora: Date = new Date()): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(ahora);
    d.setDate(d.getDate() - i);
    d.setHours(12, 0, 0, 0);
    return d;
  }).filter(d => !soloMesCorriente || d.getMonth() === ahora.getMonth());
}

export const mismoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/**
 * Cómo se nombra un día en el selector: Hoy/Ayer y luego «mié 18», más el día y el mes
 * abreviado que va dentro del cubo. El idioma lo decide quien llama (el activo), nunca
 * un locale fijo.
 */
export function describirDia(
  d: Date, hoy: Date, idioma: string, textos: { hoy: string; ayer: string },
): { nombre: string; dia: string; mes: string; larga: string } {
  const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
  const nombre = mismoDia(d, hoy) ? textos.hoy
    : mismoDia(d, ayer) ? textos.ayer
    : d.toLocaleDateString(idioma, { weekday: 'short', day: 'numeric' });
  return {
    nombre,
    dia: String(d.getDate()),
    // «sept.» → «sept»: el punto no suma en un cubo de 60.
    mes: d.toLocaleDateString(idioma, { month: 'short' }).replace('.', ''),
    larga: d.toLocaleDateString(idioma, { weekday: 'long', day: 'numeric', month: 'long' }),
  };
}
