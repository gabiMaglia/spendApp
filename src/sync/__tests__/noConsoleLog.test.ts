import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Guard T-148: `relayEngine.ts` y `contactChannel.ts` tenian cinco
 * `console.log('[DIAG ...]', ...)` de una sesion de debug que quedaron
 * trackeados — logean IDs de usuario/grupo y estado de claves en cada build,
 * inclusive produccion. Este test no prueba una funcion: prueba que ningun
 * `console.log(` vuelva a `src/sync` sin pasar por `__DEV__` (que ya lo apaga
 * en produccion) o, mejor, sin existir.
 */
const RAIZ = join(__dirname, '..', '..', '..');
const CARPETA = 'src/sync';

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

describe('src/sync no tiene console.log', () => {
  it('cero console.log( fuera de __tests__', () => {
    const ofensas: string[] = [];
    for (const ruta of archivos(join(RAIZ, CARPETA))) {
      const lineas = readFileSync(ruta, 'utf8').split('\n');
      lineas.forEach((linea, i) => {
        if (linea.trimStart().startsWith('//') || linea.trimStart().startsWith('*')) return;
        if (linea.includes('console.log(')) {
          ofensas.push(`${ruta.replace(RAIZ + '/', '')}:${i + 1}  ${linea.trim()}`);
        }
      });
    }
    expect(ofensas).toEqual([]);
  });
});
