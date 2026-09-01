import { readFileSync } from 'fs';
import { execSync } from 'child_process';

/**
 * **Todo `updatedAt` que se escriba tiene que salir del reloj corregido.**
 *
 * Este test recorre el código en vez de confiar en que alguien se acuerde. Un
 * solo punto de escritura que siga usando `Date.now()` reabre el agujero
 * entero: ese registro se estampa con la hora del teléfono y, si está
 * adelantada, gana todos los conflictos igual. Y falla en silencio — nada se
 * rompe, simplemente las ediciones de los demás dejan de aplicarse.
 *
 * Es la misma idea que `deltaCompleteness`: enumerar en vez de recordar.
 */

const ARCHIVOS = execSync(
  `grep -rl "updatedAt" src app | grep -v __tests__ || true`,
  { encoding: 'utf8' },
).split('\n').filter(Boolean);

describe('el reloj corregido se usa en TODAS partes', () => {
  it('encuentra archivos que escriben updatedAt', () => {
    expect(ARCHIVOS.length).toBeGreaterThan(5);
  });

  it('ningún updatedAt se estampa con Date.now() directo', () => {
    const culpables: string[] = [];

    for (const archivo of ARCHIVOS) {
      const texto = readFileSync(archivo, 'utf8');
      // `updatedAt: Date.now()` en cualquier forma (con espacios variables).
      if (/updatedAt:\s*Date\.now\(\)/.test(texto)) culpables.push(archivo);
    }

    expect(culpables).toEqual([]);
  });

  // Un `const now = Date.now()` que después se estampe en `updatedAt` es el
  // mismo bug con otra cara, y el chequeo de arriba no lo ve.
  it('tampoco a través de una variable intermedia', () => {
    const culpables: string[] = [];

    for (const archivo of ARCHIVOS) {
      const texto = readFileSync(archivo, 'utf8');
      const usaVariable = /updatedAt:\s*now\b/.test(texto);
      const laDefineMal = /\bnow(:\s*number)?\s*=\s*Date\.now\(\)/.test(texto);
      if (usaVariable && laDefineMal) culpables.push(archivo);
    }

    expect(culpables).toEqual([]);
  });
});

/**
 * **Y lo mismo para `votedAt`** (T-059).
 *
 * `votedAt` no es sólo la fecha que se muestra: decide qué ronda de borrado
 * está viva, qué votos sobreviven al merge y cuándo se cumplen las 72hs. Un
 * punto de emisión que vuelva a `Date.now()` reabre el mismo agujero que el de
 * `updatedAt` —el teléfono con la hora adelantada le gana a todos— y falla
 * igual de en silencio.
 *
 * Se enumera desde los llamadores de `emitirVoto`, que es el ÚNICO punto de
 * escritura de `deletionVotes` (`src/services/deletionVotes.ts`): si mañana
 * aparece una pantalla nueva que vota, entra sola.
 */
const EMISORES = execSync(
  `grep -rl "emitirVoto(" src app | grep -v __tests__ || true`,
  { encoding: 'utf8' },
).split('\n').filter(Boolean);

describe('los votos de borrado también salen del reloj corregido', () => {
  it('encuentra los puntos de emisión', () => {
    // `deletionVotes.ts` (la definición) más al menos una pantalla que la usa.
    expect(EMISORES.length).toBeGreaterThan(1);
  });

  it('ninguna emisión se fecha con `Date.now()`', () => {
    const culpables: string[] = [];

    for (const archivo of EMISORES) {
      const texto = readFileSync(archivo, 'utf8');
      // `emitirVoto(gasto, id, 'accion', Date.now())`, con espacios variables.
      if (/emitirVoto\([^)]*Date\.now\(\)/.test(texto)) culpables.push(archivo);
    }

    expect(culpables).toEqual([]);
  });

  it('ni por la puerta de atrás, escribiendo el campo a mano', () => {
    const culpables = ARCHIVOS
      .filter(a => /votedAt:\s*Date\.now\(\)/.test(readFileSync(a, 'utf8')));

    expect(culpables).toEqual([]);
  });
});
