/**
 * Guard de frontera P15, reescrito por carpeta (T-206-A, spec
 * 2026-09-28-sync-extraible-design.md §2.2, §3.1, §7.6 fila 7).
 *
 * El guard viejo (T-191/T-192) era una lista cerrada de archivos dentro de
 * `src/sync/relay/` y sólo miraba imports DIRECTOS de `@/src/store/` y
 * `@/src/types/models`. No veía MMKV transitivo, `expo-crypto`, el modelo
 * `SyncDelta` ni React/React Native. Con la mudanza a carpetas (Task 1), la
 * frontera se declara por CARPETA.
 *
 * **`nucleo/` — cero excepciones, transitividad completa.** Ningún archivo
 * bajo `src/sync/nucleo/**` puede importar, ni directa ni transitivamente,
 * nada de `@/src/store`, `@/src/types/models`, `@/src/services`, `expo-*`
 * (salvo `expo-crypto`, deuda declarada hasta V5), `@supabase/*`, `react`,
 * `react-native` ni `i18next`, y no puede salir por import relativo/alias
 * de `nucleo/`+`puertos/`. Hoy pasa limpio — es la garantía real de esta
 * tarea.
 *
 * **`nucleo/` tiene 2 excepciones puntuales, por archivo+import exacto, NO
 * por carpeta** — la medición real mostró que "cero excepciones" era
 * aspiracional para 2 de los 17 archivos, exactamente donde el arquitecto ya
 * había catalogado la deuda (§2.2). Una tercera (V3, MMKV transitivo por
 * `publicarCubos.ts` → `sliceRenewal.ts`) se cerró en el Task 2 de esta
 * misma tarea (`nucleo/limites.ts`, D8) y ya no hace falta:
 *   - `abrirSobre.ts` → tipo `SyncDelta` de `adaptadores/hushsplit/applyDelta`
 *     y tipo `Envelope` de `adaptadores/supabase/relay` (V4: «el núcleo pasa
 *     a manejar unknown, decide el codec del documento» — recién en la
 *     etapa B, spec §6).
 *   - `drainFailures.ts` → `@/src/services/errorLog` (V7: puerto Log
 *     todavía sin implementar — `puertos/puertos.ts` sólo declara el tipo
 *     en Task 2, nadie lo inyecta hasta la etapa B).
 * Ninguna otra ruta de `nucleo/` tiene permiso. Si aparece una nueva, el
 * guard la va a cazar.
 *
 * **`motor/` — la medición real (§2.2 V1/V2/V7/V9/V10) obligó a ajustar el
 * guard**, no a inventar una carpeta nueva. `relayEngine.ts` es a propósito
 * la RAÍZ DE COMPOSICIÓN de HushSplit (orquesta invitaciones y contactos,
 * motor/README §3.2) y casi todo archivo de `motor/` de hoy (`drenar.ts`,
 * `publicar.ts`, `agendaDePublicacion.ts`, `agendaDeDrenaje.ts`,
 * `claveVigente.ts`, `pendingDrain.ts`, `relayQueue.ts`, `poll.ts`) importa
 * stores/servicios directo — es EXACTAMENTE la deuda que §2.2 cataloga como
 * V1 (adaptador singleton), V2 (claves/sesión de los stores), V7 (`errorLog`
 * directo en vez de puerto Log), V9 (autoría en el loop de drenaje) y V10
 * (React Native + sesión de Supabase), y que la spec fecha para la etapa B
 * («después del lanzamiento», §6). Exigirle a `motor/` la misma pureza que
 * a `nucleo/` en esta tarea habría significado hacer la etapa B disfrazada
 * de mudanza — que es justo lo que el plan pide NO hacer (P-19, «cero
 * cambio de comportamiento»).
 *
 * Lo que el guard SÍ exige de `motor/` hoy, y que era falso antes de esta
 * tarea (no existían las carpetas):
 *   1. Nunca importa `@/src/types/models`, `expo-*` (no-crypto) ni
 *      `@supabase/*` DIRECTO — eso vive en `adaptadores/**` (V4, V5, V6).
 *   2. No se escapa de `src/sync/**`: cualquier import relativo o alias
 *      que salga de un archivo de `motor/` tiene que resolver a OTRA
 *      carpeta de `src/sync` (documentado, ver `motor/README.md`), nunca a
 *      un directorio inventado.
 *   3. Una vez que un import de `motor/` llega a una carpeta puente
 *      (`adaptadores/`, `confianza/`, `contactos/`, `invitaciones/`,
 *      `sesion/`, `avisos/`, `puertos/`), el guard NO sigue auditando
 *      puertas adentro de esa carpeta con las reglas de `motor/` — cada
 *      carpeta tiene su propia frontera (fuera de alcance de T-206-A,
 *      §7.3-§7.5). La transitividad completa (para cazar algo como V3, MMKV
 *      transitivo) sólo se seguye aplicando DENTRO de `nucleo/`+`puertos/`
 *      +`motor/`.
 *
 * El chequeo es TRANSITIVO en ese sentido acotado: sigue imports relativos
 * y `@/src/sync/...` recursivamente (memoizado), pero deja de re-aplicar
 * las reglas de origen apenas cruza a una carpeta puente.
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';

const ROOT = resolve(__dirname, '..', '..', '..');
const SYNC_DIR = join(ROOT, 'src', 'sync');
const NUCLEO_DIR = join(SYNC_DIR, 'nucleo');
const MOTOR_DIR = join(SYNC_DIR, 'motor');

/** Carpetas dentro de las cuales se sigue aplicando la MISMA regla al recursar. */
const RECURSAR_NUCLEO = new Set(['nucleo', 'puertos']);
const RECURSAR_MOTOR = new Set(['nucleo', 'puertos', 'motor']);

/** Carpetas puente: alcanzables desde `motor/`, pero opacas (no se re-audita adentro). */
const PUENTE_MOTOR = new Set(['adaptadores', 'confianza', 'contactos', 'invitaciones', 'sesion', 'avisos']);

/** Prohibidos siempre, sin excepción, para ambas carpetas (V4/V5/V6). */
const BARE_PROHIBIDOS_SIEMPRE: RegExp[] = [
  /^@\/src\/types\/models(\/|$)/,
  /^expo-(?!crypto$)/, // expo-crypto permitida hasta V5 (deuda declarada)
  /^@supabase\//,
];

/** Sólo para `nucleo/`: además, cero tolerancia a stores/servicios/RN/i18n (sin la deuda B). */
const BARE_PROHIBIDOS_NUCLEO: RegExp[] = [
  ...BARE_PROHIBIDOS_SIEMPRE,
  /^@\/src\/store(\/|$)/,
  /^@\/src\/services(\/|$)/,
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
  const candidatos = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  for (const c of candidatos) {
    if (existsSync(c)) return c;
  }
  return null;
}

function carpetaTopDeSync(archivoAbs: string): string | null {
  const rel = relative(SYNC_DIR, archivoAbs);
  if (rel.startsWith('..')) return null;
  return rel.split('/')[0];
}

type Violacion = { archivo: string; motivo: string };

/** Excepción puntual: un archivo exacto puede tener ESTE spec exacto (o matchear este patrón). */
type ExcepcionPuntual = { archivo: string; patron: RegExp };

/**
 * Las 2 excepciones puntuales de `nucleo/` que quedan (V4, V7 — spec §2.2).
 * V3 (`publicarCubos.ts` importaba `RENEWAL_WINDOW_MS` de
 * `adaptadores/hushsplit/sliceRenewal.ts`, arrastrando MMKV transitivamente)
 * se cerró en Task 2 (`nucleo/limites.ts`, D8): ya no hace falta la excepción.
 * V4 y V7 quedan para la etapa B.
 */
const EXCEPCIONES_NUCLEO: ExcepcionPuntual[] = [
  { archivo: 'src/sync/nucleo/abrirSobre.ts', patron: /^@\/src\/sync\/adaptadores\/hushsplit\/applyDelta$/ }, // V4
  { archivo: 'src/sync/nucleo/abrirSobre.ts', patron: /^@\/src\/sync\/adaptadores\/supabase\/relay$/ }, // V4 (tipo Envelope, mismo motivo)
  { archivo: 'src/sync/nucleo/drainFailures.ts', patron: /^@\/src\/services\/errorLog$/ }, // V7
];

/**
 * @param dirRaiz carpeta de arranque (nucleo/ o motor/)
 * @param recursarEn carpetas dentro de las cuales se sigue aplicando la regla completa
 * @param puente carpetas alcanzables pero opacas (no se re-audita adentro); vacío para nucleo/
 * @param bareProhibidos patrones bare prohibidos para ESTA carpeta
 * @param etiqueta nombre para el mensaje de violación
 * @param excepciones excepciones puntuales por archivo+spec exacto (default: ninguna)
 */
function chequearCarpeta(
  dirRaiz: string,
  recursarEn: Set<string>,
  puente: Set<string>,
  bareProhibidos: RegExp[],
  etiqueta: string,
  excepciones: ExcepcionPuntual[] = [],
): Violacion[] {
  const violaciones: Violacion[] = [];
  const visitados = new Set<string>();

  function visitar(archivoAbs: string) {
    if (visitados.has(archivoAbs)) return;
    visitados.add(archivoAbs);
    if (!existsSync(archivoAbs)) return;
    const contenido = readFileSync(archivoAbs, 'utf8');
    const relPath = relative(ROOT, archivoAbs);

    for (const spec of especificadoresDe(contenido)) {
      if (excepciones.some(e => e.archivo === relPath && e.patron.test(spec))) continue;

      for (const patron of bareProhibidos) {
        if (patron.test(spec)) {
          violaciones.push({ archivo: relPath, motivo: `${etiqueta}: import prohibido "${spec}" (${patron})` });
        }
      }

      let destinoAbs: string | null = null;
      if (spec.startsWith('.')) {
        destinoAbs = resolverArchivo(resolve(dirname(archivoAbs), spec));
      } else if (spec.startsWith('@/src/sync/')) {
        destinoAbs = resolverArchivo(resolve(ROOT, spec.slice(2)));
      } else {
        continue; // bare no-sync — ya cubierto arriba si estaba prohibido
      }
      if (!destinoAbs) continue;
      const carpetaDestino = carpetaTopDeSync(destinoAbs);
      if (!carpetaDestino) continue;

      if (recursarEn.has(carpetaDestino)) {
        visitar(destinoAbs); // misma tropa de reglas, un nivel más adentro
      } else if (puente.has(carpetaDestino)) {
        continue; // carpeta puente: alcanzable, pero opaca — no se re-audita
      } else {
        violaciones.push({
          archivo: relPath,
          motivo: `${etiqueta}: import relativo/alias sale de src/sync hacia una carpeta no reconocida "${carpetaDestino}" (${relative(ROOT, destinoAbs)})`,
        });
      }
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
    const violaciones = chequearCarpeta(NUCLEO_DIR, RECURSAR_NUCLEO, new Set(), BARE_PROHIBIDOS_NUCLEO, 'nucleo', EXCEPCIONES_NUCLEO);
    expect(violaciones).toEqual([]);
  });

  it('motor/** no importa @/src/types/models, expo-* (no-crypto) ni @supabase/* directo, y no se escapa de src/sync', () => {
    const archivos = tsFilesRecursivos(MOTOR_DIR);
    expect(archivos.length).toBeGreaterThan(0);
    const violaciones = chequearCarpeta(MOTOR_DIR, RECURSAR_MOTOR, PUENTE_MOTOR, BARE_PROHIBIDOS_SIEMPRE, 'motor');
    expect(violaciones).toEqual([]);
  });
});
