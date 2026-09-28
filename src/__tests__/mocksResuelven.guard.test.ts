/**
 * Guard nuevo de la mudanza (T-206-A, spec §3.3 paso 5, plan Task 0).
 *
 * La mudanza de `src/sync/**` a carpetas (Task 1) reescribe cientos de
 * especificadores de `jest.mock`/`jest.doMock`. El riesgo descrito en la
 * spec (§3.3 "la trampa de identidad de `jest.mock`") es silencioso: un
 * mock que apunta a una ruta que YA NO EXISTE no falla — Jest simplemente
 * deja de mockear ese módulo y el test pasa a ejercitar el código real, a
 * veces por la razón equivocada.
 *
 * Este guard barre TODO `src/**` y `app/**` y verifica:
 * - cada `jest.mock`/`jest.doMock` SIN `{ virtual: true }` tiene que
 *   resolver a un archivo real (si no resuelve, la mudanza dejó un mock
 *   huérfano);
 * - cada uno CON `{ virtual: true }` tiene que apuntar a algo que NO
 *   existe a propósito (si resuelve, `virtual: true` está de más y
 *   esconde que el mock podría ser uno real — es exactamente el caso de
 *   los 4 mocks de `'../relayEngine'` que D15 corrige).
 *
 * La resolución usa `require.resolve` DENTRO del entorno de Jest, que ya
 * respeta `moduleNameMapper` (alias `@/`) y `moduleFileExtensions` — es la
 * misma resolución que usaría el propio `jest.mock` en tiempo de test.
 */
import { readdirSync, existsSync, statSync, readFileSync } from 'fs';
import { join, dirname, resolve as resolvePath } from 'path';

const ROOT = join(__dirname, '..', '..');
const DIRS = [join(ROOT, 'src'), join(ROOT, 'app')];

function tsFilesRecursivos(dir: string): string[] {
  const entradas = readdirSync(dir, { withFileTypes: true });
  const archivos: string[] = [];
  for (const entrada of entradas) {
    if (entrada.isDirectory()) {
      if (entrada.name === 'node_modules') continue;
      archivos.push(...tsFilesRecursivos(join(dir, entrada.name)));
    } else if (entrada.isFile() && /\.(ts|tsx)$/.test(entrada.name)) {
      archivos.push(join(dir, entrada.name));
    }
  }
  return archivos;
}

type Mock = { archivo: string; spec: string; virtual: boolean; index: number };

function mocksDe(archivo: string, contenido: string): Mock[] {
  const mocks: Mock[] = [];
  const re = /jest\.(?:mock|doMock)\(\s*['"]([^'"]+)['"]/g;
  const aperturas: { index: number; spec: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(contenido))) aperturas.push({ index: m.index, spec: m[1] });

  for (let i = 0; i < aperturas.length; i++) {
    const inicio = aperturas[i].index;
    const fin = i + 1 < aperturas.length ? aperturas[i + 1].index : contenido.length;
    const ventana = contenido.slice(inicio, fin);
    const virtual = /virtual\s*:\s*true/.test(ventana);
    mocks.push({ archivo, spec: aperturas[i].spec, virtual, index: inicio });
  }
  return mocks;
}

const EXTENSIONES = ['', '.ts', '.tsx', '.js', '.jsx', '.json'];

/**
 * Resuelve un especificador como lo haría Jest: alias `@/` → rootDir,
 * relativo → dirname del archivo, bare → node_modules. Para archivos de
 * código prueba extensiones y `index.*`; un archivo de asset (imagen,
 * fuente) ya viene con su propia extensión en el spec y se chequea tal cual.
 */
function resuelve(spec: string, fromDir: string): boolean {
  let base: string;
  if (spec.startsWith('@/')) {
    base = resolvePath(ROOT, spec.slice(2));
  } else if (spec.startsWith('.')) {
    base = resolvePath(fromDir, spec);
  } else {
    // bare (npm package) — resolución real de Node/node_modules
    try {
      require.resolve(spec, { paths: [fromDir] });
      return true;
    } catch {
      return false;
    }
  }
  if (/\.(jpg|jpeg|png|gif|webp|ttf|otf|woff2?|svg)$/i.test(base)) {
    return existsSync(base) && statSync(base).isFile();
  }
  for (const ext of EXTENSIONES) {
    const candidato = base + ext;
    if (existsSync(candidato) && statSync(candidato).isFile()) return true;
  }
  for (const ext of ['.ts', '.tsx', '.js']) {
    const candidato = join(base, `index${ext}`);
    if (existsSync(candidato) && statSync(candidato).isFile()) return true;
  }
  return false;
}

describe('mocks resuelven (T-206-A, spec §3.3 paso 5)', () => {
  const archivos = DIRS.flatMap(tsFilesRecursivos);
  const todosLosMocks: Mock[] = [];
  for (const archivo of archivos) {
    const contenido = readFileSync(archivo, 'utf8');
    todosLosMocks.push(...mocksDe(archivo, contenido));
  }

  it('encontró jest.mock/jest.doMock en el árbol (sanity check)', () => {
    expect(todosLosMocks.length).toBeGreaterThan(0);
  });

  it('todo jest.mock/jest.doMock SIN virtual:true resuelve a un archivo existente', () => {
    const huerfanos = todosLosMocks
      .filter(m => !m.virtual)
      .filter(m => !resuelve(m.spec, dirname(m.archivo)))
      .map(m => `${m.archivo.replace(ROOT + '/', '')} → "${m.spec}"`);
    expect(huerfanos).toEqual([]);
  });

  it('todo jest.mock/jest.doMock CON virtual:true de un módulo JS/TS apunta a algo que NO existe a propósito', () => {
    // Los mocks virtuales de ASSETS (imagen/fuente) son un patrón legítimo y
    // ajeno a esta mudanza: bajo Jest cualquier imagen se transforma al
    // mismo valor (`assetFileTransformer`), así que un test que necesita
    // distinguir dos imágenes las mockea con `{ virtual: true }` aunque el
    // archivo exista de verdad — no es la trampa de identidad de módulo que
    // este guard busca (spec §3.3 paso 5, sobre `jest.mock('../relayEngine')`).
    const esAsset = (spec: string) => /\.(jpg|jpeg|png|gif|webp|ttf|otf|woff2?|svg)$/i.test(spec);
    const virtualesQueResuelven = todosLosMocks
      .filter(m => m.virtual && !esAsset(m.spec))
      .filter(m => resuelve(m.spec, dirname(m.archivo)))
      .map(m => `${m.archivo.replace(ROOT + '/', '')} → "${m.spec}" (virtual:true mockea una ruta REAL)`);
    expect(virtualesQueResuelven).toEqual([]);
  });
});
