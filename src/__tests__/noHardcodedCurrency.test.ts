import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Guard de una clase de bug que ya mordio TRES veces el mismo dia (29/08/2026):
 * `groups.tsx`, `friends.tsx` e `index.tsx` filtraban saldos por `'ARS'`
 * LITERAL. A cualquier usuario cuyos grupos no fueran en pesos argentinos le
 * mostraban 0 en «te deben» y «debés» — no un error, un cero silencioso.
 *
 * Este test no prueba una funcion: prueba que el patron no vuelva. Se repitio
 * copiado y pegado entre pantallas, asi que la proxima pantalla lo iba a
 * repetir tambien. La moneda de visualizacion sale de `useFx()`.
 */
const RAIZ = join(__dirname, '..', '..');
const CARPETAS = ['app', 'src/components'];

// Filtrar o formatear saldos con una moneda escrita a mano. Los DEFAULTS de
// props opcionales (`currency = 'ARS'`) no entran: no descartan datos.
const PROHIBIDO = [
  /\.currency\s*===\s*'[A-Z]{3}'/,
  /formatMoney\(\s*[A-Za-z_][A-Za-z0-9_]*\s*,\s*'[A-Z]{3}'\s*\)/,
  // Prop de JSX con la moneda escrita a mano. Se agrego el 30/08 porque el
  // guard NO atrapo `<MoneyText code="ARS">` en el dashboard: los montos se
  // convertian bien a la moneda elegida y se mostraban con el simbolo de
  // pesos. El patron era el mismo; lo que fallaba era el alcance del guard.
  /\b(code|currency)=["'][A-Z]{3}["']/,
];

function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre === '__tests__' || nombre === 'node_modules') continue;
      out.push(...archivos(ruta));
    } else if (/\.tsx?$/.test(nombre)) {
      out.push(ruta);
    }
  }
  return out;
}

describe('ninguna pantalla filtra saldos por una moneda escrita a mano', () => {
  it.each(CARPETAS)('%s', (carpeta) => {
    const ofensas: string[] = [];
    for (const ruta of archivos(join(RAIZ, carpeta))) {
      const lineas = readFileSync(ruta, 'utf8').split('\n');
      lineas.forEach((linea, i) => {
        if (linea.trimStart().startsWith('//') || linea.trimStart().startsWith('*')) return;
        if (PROHIBIDO.some(re => re.test(linea))) {
          ofensas.push(`${ruta.replace(RAIZ + '/', '')}:${i + 1}  ${linea.trim()}`);
        }
      });
    }
    expect(ofensas).toEqual([]);
  });
});
