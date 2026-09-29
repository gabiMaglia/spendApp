/**
 * Guard de tamaño de `src/components/**` (T-218, PO 2026-09-28: «260
 * referencia, 400 tope duro»). Mismo criterio que el guard de `src/sync/**`
 * (`src/sync/__tests__/relayModulos.guard.test.ts`).
 *
 * `EXCEPCIONES` lista los archivos que YA pasaban el tope cuando se agregó el
 * guard, con su ticket: no pueden crecer más, y salen de la lista cuando se
 * parten. Un archivo nuevo sobre el tope rompe el test.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const LIMITE_DURO = 400;
const RAIZ = join(__dirname, '..');

/** Archivo (relativo a src/components) → largo máximo tolerado hasta partirlo. */
const EXCEPCIONES: Record<string, number> = {
  'Sheet.tsx': 660, // T-223
};

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

describe('tope de tamaño de archivo — src/components/** (400 duro, T-218)', () => {
  it('ningún componente supera 400 líneas (salvo las excepciones anotadas, que no crecen)', () => {
    const excedidos = archivos(RAIZ)
      .map(f => ({ f: relative(RAIZ, f), n: lineas(f) }))
      .filter(({ f, n }) => n > (EXCEPCIONES[f] ?? LIMITE_DURO))
      .map(({ f, n }) => `${f}: ${n}`);
    expect(excedidos).toEqual([]);
  });

  it('las excepciones siguen existiendo (si se partió, sacala de la lista)', () => {
    for (const [f, max] of Object.entries(EXCEPCIONES)) {
      expect(existsSync(join(RAIZ, f))).toBe(true);
      expect(lineas(join(RAIZ, f))).toBeGreaterThan(LIMITE_DURO);
      expect(max).toBeGreaterThan(LIMITE_DURO);
    }
  });
});
