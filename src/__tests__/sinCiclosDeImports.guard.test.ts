/**
 * Guard: sin ciclos de imports en `src/**` y `app/**` (T-217).
 *
 * Metro avisaba «Require cycle» al arrancar por dos ciclos: stores de sesión
 * (`userScope → authStore → accountLink → identityStore → userScope`) y stores
 * de datos ↔ motor de sync (`groupStore → relayEngine → … → groupStore`). Un
 * ciclo de carga es frágil: según el orden, un módulo lee algo del otro antes
 * de que exista y queda `undefined`.
 *
 * Qué cuenta como arista: `import`/`export … from` de VALORES (los de sólo
 * tipos se borran al compilar). Un `require` perezoso DENTRO de una función
 * no cuenta a propósito: corre al llamarla, no al cargar el módulo, y es el
 * patrón que ya usa el repo para cortar ciclos de carga (`pendingDrain.ts`,
 * `ownerPledge.ts`, `src/store/publicarGrupo.ts`).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';

const RAIZ = join(__dirname, '..', '..');
const OMITIR = new Set(['node_modules', '__tests__', 'android', 'ios']);

function fuentes(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (OMITIR.has(e.name) || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...fuentes(p));
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|d)\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function resolver(desde: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(RAIZ, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(desde), spec);
  else return null;
  const candidatos = [
    base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx'),
  ];
  return candidatos.find(c => existsSync(c) && statSync(c).isFile()) ?? null;
}

function soloTipos(clausula: string): boolean {
  const c = clausula.trim();
  if (!/^\{[^}]*\}$/.test(c)) return false;
  const nombres = c.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
  return nombres.length > 0 && nombres.every(n => n.startsWith('type '));
}

function grafo(): Map<string, string[]> {
  const g = new Map<string, string[]>();
  for (const f of [...fuentes(join(RAIZ, 'src')), ...fuentes(join(RAIZ, 'app'))]) {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const deps = new Set<string>();
    for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\b)([\s\S]*?)from\s+['"]([^'"]+)['"]/gm)) {
      if (soloTipos(m[1])) continue;
      const r = resolver(f, m[2]);
      if (r) deps.add(r);
    }
    for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
      const r = resolver(f, m[1]);
      if (r) deps.add(r);
    }
    g.set(f, [...deps]);
  }
  return g;
}

/** Componentes fuertemente conexos de más de un archivo (Tarjan) = ciclos. */
function ciclos(g: Map<string, string[]>): string[][] {
  let i = 0;
  const pila: string[] = [];
  const enPila = new Set<string>();
  const idx = new Map<string, number>();
  const bajo = new Map<string, number>();
  const out: string[][] = [];
  const visitar = (v: string) => {
    idx.set(v, i); bajo.set(v, i); i++;
    pila.push(v); enPila.add(v);
    for (const w of g.get(v) ?? []) {
      if (!g.has(w)) continue;
      if (!idx.has(w)) { visitar(w); bajo.set(v, Math.min(bajo.get(v)!, bajo.get(w)!)); }
      else if (enPila.has(w)) bajo.set(v, Math.min(bajo.get(v)!, idx.get(w)!));
    }
    if (bajo.get(v) === idx.get(v)) {
      const c: string[] = [];
      let w: string;
      do { w = pila.pop()!; enPila.delete(w); c.push(w); } while (w !== v);
      if (c.length > 1) out.push(c.map(x => relative(RAIZ, x)).sort());
    }
  };
  for (const v of g.keys()) if (!idx.has(v)) visitar(v);
  return out;
}

describe('sin ciclos de imports (T-217)', () => {
  it('el grafo de imports de src/ y app/ no tiene ciclos de carga', () => {
    expect(ciclos(grafo())).toEqual([]);
  });

  it('el detector ve el grafo real (no está mirando una carpeta vacía)', () => {
    const g = grafo();
    expect(g.size).toBeGreaterThan(300);
    const groupStore = join(RAIZ, 'src/store/groupStore.ts');
    expect(g.get(groupStore)?.length ?? 0).toBeGreaterThan(0);
  });
});
