/**
 * Guard de tamaño de las pantallas en `app/**` (T-223, PO 2026-09-28: «260
 * referencia, 400 tope duro»). Mismo criterio que el de `src/components/**`.
 *
 * `EXCEPCIONES` son las pantallas que YA pasaban el tope, con su largo de hoy:
 * no pueden crecer, y salen de la lista cuando se parten.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const LIMITE_DURO = 400;
const RAIZ = join(__dirname, '..', '..', 'app');

// T-223 terminado (2026-09-29): ninguna pantalla pasa el tope. Una excepción
// nueva sólo con ticket y largo actual, y no puede crecer.
const EXCEPCIONES: Record<string, number> = {};

function lineas(path: string): number {
  const l = readFileSync(path, 'utf8').split('\n');
  if (l[l.length - 1] === '') l.pop();
  return l.length;
}

function archivos(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === '__tests__') continue;
      out.push(...archivos(join(dir, e.name)));
    } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

describe('tope de tamaño de archivo — app/** (400 duro, T-223)', () => {
  it('ninguna pantalla supera 400 líneas (salvo las excepciones anotadas, que no crecen)', () => {
    const excedidos = archivos(RAIZ)
      .map(f => ({ f: relative(RAIZ, f), n: lineas(f) }))
      .filter(({ f, n }) => n > (EXCEPCIONES[f] ?? LIMITE_DURO))
      .map(({ f, n }) => `${f}: ${n}`);
    expect(excedidos).toEqual([]);
  });

  it('las excepciones siguen existiendo y siguen pasadas (si se partió, sacala de la lista)', () => {
    for (const f of Object.keys(EXCEPCIONES)) {
      expect(existsSync(join(RAIZ, f))).toBe(true);
      expect(lineas(join(RAIZ, f))).toBeGreaterThan(LIMITE_DURO);
    }
  });
});
