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
