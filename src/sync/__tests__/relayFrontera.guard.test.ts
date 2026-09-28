/**
 * Guard de frontera P15, reescrito por carpeta (T-206-A, spec
 * 2026-09-28-sync-extraible-design.md §2.2, §3.1, §7.6 fila 7).
 *
 * El guard viejo (T-191/T-192) era una lista cerrada de archivos dentro de
 * `src/sync/relay/` y sólo miraba imports DIRECTOS de `@/src/store/` y
 * `@/src/types/models`. No veía MMKV transitivo (V3: `publicarCubos` →
 * `sliceRenewal` → `createStorage`), `expo-crypto`, el modelo `SyncDelta`
 * ni React/React Native. Con la mudanza a carpetas (Task 1), la frontera se
 * declara por CARPETA: todo archivo bajo `src/sync/nucleo/**` no puede
 * importar, ni directa ni transitivamente, nada de `@/src/store`,
 * `@/src/types/models`, `@/src/services`, `expo-*` (salvo `expo-crypto`,
 * permitida hasta V5 — spec §2.2 V5), `@supabase/*`, `react`,
 * `react-native` ni `i18next`; tampoco puede salir por import relativo de
 * `nucleo/`+`motor/`+`puertos/`.
 *
 * `motor/` tiene UNA excepción declarada a propósito (deuda etapa B, spec
 * §2.2 V1/V2): puede importar `adaptadores/**` y `confianza/**` porque hoy
 * el adaptador entra como módulo singleton y las claves se leen de los
 * stores a través de él. `nucleo/` no tiene ninguna excepción.
 *
 * El chequeo es TRANSITIVO: sigue imports relativos y `@/src/sync/...`
 * recursivamente (memoizado) en vez de mirar sólo la primera línea.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';

const ROOT = resolve(__dirname, '..', '..', '..');
const SYNC_DIR = join(ROOT, 'src', 'sync');
const NUCLEO_DIR = join(SYNC_DIR, 'nucleo');
const MOTOR_DIR = join(SYNC_DIR, 'motor');

/** Carpetas a las que `nucleo/` y `motor/` tienen permitido llegar por import relativo/alias. */
const CARPETAS_PERMITIDAS_NUCLEO = new Set(['nucleo', 'puertos']);
const CARPETAS_PERMITIDAS_MOTOR = new Set(['nucleo', 'puertos', 'motor', 'adaptadores', 'confianza']);

/** Especificadores "bare" prohibidos (no relativos, no `@/`), con la excepción declarada. */
const BARE_PROHIBIDOS: RegExp[] = [
  /^@\/src\/store(\/|$)/,
  /^@\/src\/types\/models(\/|$)/,
  /^@\/src\/services(\/|$)/,
  /^expo-(?!crypto$)/, // expo-crypto permitida hasta V5 (deuda declarada)
  /^@supabase\//,
  /^react$/,
  /^react-native/,
  /^i18next/,
  /^react-i18next/,
];

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

/** Extrae todos los especificadores de import/export/require/dynamic-import de un archivo. */
function especificadoresDe(contenido: string): string[] {
  const specs: string[] = [];
  const patrones = [
    /import\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /export\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patrones) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(contenido))) specs.push(m[1]);
  }
  return specs;
}

function resolverArchivo(base: string): string | null {
  const candidatos = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  for (const c of candidatos) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

function carpetaTopDeSync(archivoAbs: string): string | null {
  const rel = relative(SYNC_DIR, archivoAbs);
  if (rel.startsWith('..')) return null;
  return rel.split('/')[0];
}

type Violacion = { archivo: string; motivo: string };

function chequearCarpeta(dirRaiz: string, permitidas: Set<string>, etiqueta: string): Violacion[] {
  const violaciones: Violacion[] = [];
  const visitados = new Set<string>();

  function visitar(archivoAbs: string) {
    if (visitados.has(archivoAbs)) return;
    visitados.add(archivoAbs);
    if (!existsSync(archivoAbs)) return;
    const contenido = readFileSync(archivoAbs, 'utf8');
    const relPath = relative(ROOT, archivoAbs);

    for (const spec of especificadoresDe(contenido)) {
      // 1) especificador bare prohibido
      for (const patron of BARE_PROHIBIDOS) {
        if (patron.test(spec)) {
          violaciones.push({ archivo: relPath, motivo: `${etiqueta}: import prohibido "${spec}" (${patron})` });
        }
      }
      // 2) import relativo o @/src/sync/... — seguir transitivamente y chequear carpeta destino
      let destinoAbs: string | null = null;
      if (spec.startsWith('.')) {
        destinoAbs = resolverArchivo(resolve(dirname(archivoAbs), spec));
      } else if (spec.startsWith('@/src/sync/')) {
        destinoAbs = resolverArchivo(resolve(ROOT, spec.slice(2)));
      } else {
        continue; // bare no-sync (node_modules, etc.) — ya cubierto arriba si estaba prohibido
      }
      if (!destinoAbs) continue;
      const carpetaDestino = carpetaTopDeSync(destinoAbs);
      if (carpetaDestino && !permitidas.has(carpetaDestino)) {
        violaciones.push({
          archivo: relPath,
          motivo: `${etiqueta}: import relativo/alias sale de las carpetas permitidas hacia "${carpetaDestino}" (${relative(ROOT, destinoAbs)})`,
        });
      }
      // seguir transitivamente sólo dentro de src/sync
      if (destinoAbs.startsWith(SYNC_DIR)) visitar(destinoAbs);
    }
  }

  for (const archivo of tsFilesRecursivos(dirRaiz)) visitar(archivo);
  return violaciones;
}

describe('frontera por carpeta, transitiva (T-206-A, spec §2.2)', () => {
  it('nucleo/ y motor/ existen (mudanza Task 1)', () => {
    expect(existsSync(NUCLEO_DIR)).toBe(true);
    expect(existsSync(MOTOR_DIR)).toBe(true);
  });

  it('nucleo/** no importa nada de la app, ni directa ni transitivamente (sin excepciones)', () => {
    const archivos = tsFilesRecursivos(NUCLEO_DIR);
    expect(archivos.length).toBeGreaterThan(0);
    const violaciones = chequearCarpeta(NUCLEO_DIR, CARPETAS_PERMITIDAS_NUCLEO, 'nucleo');
    expect(violaciones).toEqual([]);
  });

  it('motor/** sólo puede salir hacia nucleo/puertos/motor/adaptadores/confianza (deuda etapa B)', () => {
    const archivos = tsFilesRecursivos(MOTOR_DIR);
    expect(archivos.length).toBeGreaterThan(0);
    const violaciones = chequearCarpeta(MOTOR_DIR, CARPETAS_PERMITIDAS_MOTOR, 'motor');
    expect(violaciones).toEqual([]);
  });
});
