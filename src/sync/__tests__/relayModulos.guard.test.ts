/**
 * T-189: guard de tamaño. `relayEngine.ts` (fachada) y cada módulo de
 * `src/sync/relay/*.ts` tienen tope duro de 260 líneas (comentarios
 * incluidos) — es lo que fuerza a que el archivo de 1101 líneas quede
 * partido en piezas chicas, con un dueño claro cada una, en vez de una
 * fachada que reacumula todo de nuevo.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const LIMITE = 260;
const LIMITE_REFERENCIA = 260;
const LIMITE_DURO = 400;
const SYNC_DIR = join(__dirname, '..');
const RELAY_DIR = join(SYNC_DIR, 'relay');

function lineCount(path: string): number {
  const contenido = readFileSync(path, 'utf8');
  // Un archivo terminado en salto de línea no cuenta una línea vacía extra.
  const lineas = contenido.split('\n');
  if (lineas[lineas.length - 1] === '') lineas.pop();
  return lineas.length;
}

function tsFilesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith('.ts') && !d.name.endsWith('.d.ts'))
    .map(d => join(dir, d.name));
}

// T-192: recorre src/sync recursivamente, excluyendo cualquier carpeta
// __tests__ (los tests no entran en el tope de producción).
function tsFilesRecursivos(dir: string): string[] {
  const entradas = readdirSync(dir, { withFileTypes: true });
  const archivos: string[] = [];
  for (const entrada of entradas) {
    if (entrada.isDirectory()) {
      if (entrada.name === '__tests__') continue;
      archivos.push(...tsFilesRecursivos(join(dir, entrada.name)));
    } else if (entrada.isFile() && entrada.name.endsWith('.ts') && !entrada.name.endsWith('.d.ts')) {
      archivos.push(join(dir, entrada.name));
    }
  }
  return archivos;
}

describe('tope de tamaño de archivo (T-189)', () => {
  it('relayEngine.ts no supera 260 líneas', () => {
    const path = join(SYNC_DIR, 'relayEngine.ts');
    const n = lineCount(path);
    expect(n).toBeLessThanOrEqual(LIMITE);
  });

  it('cada módulo en src/sync/relay/*.ts no supera 260 líneas', () => {
    const archivos = tsFilesIn(RELAY_DIR);
    // Si el directorio no existe todavía o está vacío, este test no puede
    // pasar por vacuidad: el refactor exige que la partición exista.
    expect(archivos.length).toBeGreaterThan(0);

    const excedidos = archivos
      .map(path => ({ path, n: lineCount(path) }))
      .filter(({ n }) => n > LIMITE);

    expect(excedidos).toEqual([]);
  });
});

describe('tope de tamaño de archivo (T-192)', () => {
  it('relaySync.ts no supera 260 líneas', () => {
    const path = join(SYNC_DIR, 'relaySync.ts');
    const n = lineCount(path);
    expect(n).toBeLessThanOrEqual(LIMITE_REFERENCIA);
  });

  it('ningún archivo de producción bajo src/sync/** supera 400 líneas', () => {
    const archivos = tsFilesRecursivos(SYNC_DIR);
    const excedidos = archivos
      .map(path => ({ path, n: lineCount(path) }))
      .filter(({ n }) => n > LIMITE_DURO);

    expect(excedidos).toEqual([]);
  });
});
