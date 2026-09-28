/**
 * Guard de tamaño (T-189/T-192, reescrito en T-206-A tras la mudanza a
 * carpetas — plan `engram/plans/T-206-A.md` Task 0/1).
 *
 * Antes: `relayEngine.ts` y `src/sync/relay/*.ts` sueltos a 260, y
 * `relaySync.ts` + el resto de `src/sync/**` a 400. Esas rutas dejan de
 * existir con la mudanza (`relay/` se reparte entre `nucleo/`, `motor/`,
 * `adaptadores/`, etc. — spec 2026-09-28-sync-extraible-design.md §3.1).
 *
 * Ahora: barrido recursivo de TODO `src/sync/**` con tope duro 400
 * (comentarios incluidos), y barrido recursivo, por separado, de
 * `nucleo/` + `motor/` con tope de referencia 260 — son las dos carpetas
 * candidatas al paquete futuro (spec §6 etapa (c)), así que se piden más
 * chicas y legibles que el resto.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const LIMITE_REFERENCIA = 260;
const LIMITE_DURO = 400;
const SYNC_DIR = join(__dirname, '..');
const NUCLEO_DIR = join(SYNC_DIR, 'nucleo');
const MOTOR_DIR = join(SYNC_DIR, 'motor');

function lineCount(path: string): number {
  const contenido = readFileSync(path, 'utf8');
  // Un archivo terminado en salto de línea no cuenta una línea vacía extra.
  const lineas = contenido.split('\n');
  if (lineas[lineas.length - 1] === '') lineas.pop();
  return lineas.length;
}

function tsFilesRecursivos(dir: string): string[] {
  if (!existsSync(dir)) return [];
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

describe('tope de tamaño de archivo — src/sync/** (400 duro, T-206-A)', () => {
  it('ningún archivo de producción bajo src/sync/** supera 400 líneas', () => {
    const archivos = tsFilesRecursivos(SYNC_DIR);
    expect(archivos.length).toBeGreaterThan(0);

    const excedidos = archivos
      .map(path => ({ path, n: lineCount(path) }))
      .filter(({ n }) => n > LIMITE_DURO);

    expect(excedidos).toEqual([]);
  });
});

describe('tope de tamaño de archivo — nucleo/ y motor/ (260 referencia, T-206-A)', () => {
  it('nucleo/ existe y ningún archivo supera 260 líneas', () => {
    const archivos = tsFilesRecursivos(NUCLEO_DIR);
    expect(archivos.length).toBeGreaterThan(0);

    const excedidos = archivos
      .map(path => ({ path, n: lineCount(path) }))
      .filter(({ n }) => n > LIMITE_REFERENCIA);

    expect(excedidos).toEqual([]);
  });

  it('motor/ existe y ningún archivo supera 260 líneas', () => {
    const archivos = tsFilesRecursivos(MOTOR_DIR);
    expect(archivos.length).toBeGreaterThan(0);

    const excedidos = archivos
      .map(path => ({ path, n: lineCount(path) }))
      .filter(({ n }) => n > LIMITE_REFERENCIA);

    expect(excedidos).toEqual([]);
  });
});
