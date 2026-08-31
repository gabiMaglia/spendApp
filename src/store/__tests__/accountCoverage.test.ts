import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { COBERTURA_FUSION, EXCLUIDOS_FUSION } from '../accountLink';

/**
 * Guard de la clase de bug que ya mordió CUATRO veces: data que se persiste
 * scopeada por cuenta y que nadie fusiona al enlazar dos cuentas — o que nadie
 * suelta al cambiar de cuenta activa.
 *
 *  1. `personal` — leía una clave inexistente y reportaba la fusión como
 *     exitosa con cero registros; los movimientos desaparecían en silencio.
 *  2. `groupkeys` — sin la clave, el device no puede descifrar los sobres del
 *     grupo: los gastos llegan y no se pueden leer (T-047).
 *  3. `archived_v1` — mismo bucket que groups pero otra clave, fuera del merge.
 *  4. Las cachés de T-041 no se soltaban al cambiar de cuenta: una cuenta que
 *     entraba después de otra en el mismo arranque leía los veredictos y las
 *     claves de la anterior, y al guardar los escribía bajo SU scope. Lo
 *     encontró un humano leyendo — este guard no podía verlo porque sólo
 *     escaneaba `src/store/`, y esa data vive en `src/sync/` (T-055).
 *
 * El patrón nunca fue "faltaba un store": es que la lista se escribe a mano y
 * se desincroniza. Por eso el escaneo es RECURSIVO sobre `src/` — un directorio
 * nuevo entra solo, sin que nadie se acuerde de agregarlo acá.
 *
 * Son DOS invariantes distintas y hacen falta las dos:
 *   (a) ¿esta data se fusiona cuando dos cuentas se enlazan?
 *   (b) ¿se SUELTA al cambiar de cuenta activa?
 *
 * Lo que este guard NO puede hacer: juzgar si la razón de una exclusión es
 * cierta. Verifica que esté ESCRITA y que sea una razón, no una palabra. Que
 * sea verdad lo tiene que sostener quien la escribe — por eso las exclusiones
 * viven en su propia tabla, a la vista, y no diluidas entre las coberturas.
 */
const SRC = join(__dirname, '..', '..');
const SESSION = readFileSync(join(SRC, 'store', 'session.ts'), 'utf8');

/** Todos los fuentes de `src/`, recursivo. Los tests no cuentan. */
function fuentes(dir: string = SRC): string[] {
  return readdirSync(dir).flatMap(entrada => {
    if (entrada === '__tests__') return [];
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) return fuentes(ruta);
    return /\.tsx?$/.test(entrada) ? [ruta] : [];
  });
}

/** Id estable y sin ambigüedad: la ruta desde `src/`, sin extensión. */
function idDeModulo(ruta: string): string {
  return relative(SRC, ruta).replace(/\.tsx?$/, '').split(sep).join('/');
}

type Modulo = { id: string; enMemoria: boolean };

/**
 * Módulos que persisten scopeados por cuenta, con la marca de si además
 * guardan esa data EN MEMORIA entre llamadas.
 *
 * Los dos casos son: un store de zustand (el estado vive en el closure) o una
 * variable de módulo mutable. Los que leen del disco en cada llamada no tienen
 * nada que soltar — no hay copia vieja que sobreviva al cambio de cuenta.
 */
function modulosScopeados(): Modulo[] {
  return fuentes()
    .map(ruta => ({ ruta, src: readFileSync(ruta, 'utf8') }))
    .filter(({ src }) => /\bwriteScoped(Bool)?\s*\(/.test(src))
    .map(({ ruta, src }) => ({
      id: idDeModulo(ruta),
      enMemoria:
        /\bcreate\s*[<(]/.test(src) ||
        /^let\s+\w+/m.test(src) ||
        /^const\s+\w+\s*=\s*new\s+(Map|Set)\b/m.test(src),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** `@/src/sync/ratchet` y `./groupStore` son el mismo tipo de cosa: un id. */
function idDeEspecificador(spec: string): string | null {
  if (spec.startsWith('@/src/')) return spec.slice('@/src/'.length);
  if (spec.startsWith('./')) return `store/${spec.slice(2)}`;
  return null;
}

/** Qué nombres importa `session.ts` de cada módulo. */
function importesDeSession(): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  for (const m of SESSION.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+'([^']+)'/g)) {
    const id = idDeEspecificador(m[2]);
    if (!id) continue;
    const nombres = m[1]
      .split(',')
      .map(n => n.trim().split(/\s+as\s+/).pop()!.trim())
      .filter(Boolean);
    mapa.set(id, [...(mapa.get(id) ?? []), ...nombres]);
  }
  return mapa;
}

/** El cuerpo de `rehydrateForActiveUser`, que es donde se suelta todo. */
function cuerpoRehidratacion(): string {
  const inicio = SESSION.indexOf('export function rehydrateForActiveUser');
  const fin = SESSION.indexOf('\n}', inicio);
  return SESSION.slice(inicio, fin);
}

describe('(a) la fusión de cuentas cubre todo lo que se persiste por cuenta', () => {
  it('ningún módulo scopeado queda sin declarar', () => {
    const sinDeclarar = modulosScopeados()
      .map(m => m.id)
      .filter(id => !(id in COBERTURA_FUSION) && !(id in EXCLUIDOS_FUSION));
    expect(sinDeclarar).toEqual([]);
  });

  it('no quedan declaraciones de módulos que ya no existen', () => {
    const reales = new Set(modulosScopeados().map(m => m.id));
    const declarados = [...Object.keys(COBERTURA_FUSION), ...Object.keys(EXCLUIDOS_FUSION)];
    expect(declarados.filter(id => !reales.has(id))).toEqual([]);
  });

  it('nada está fusionado y excluido a la vez', () => {
    const ambos = Object.keys(COBERTURA_FUSION).filter(id => id in EXCLUIDOS_FUSION);
    expect(ambos).toEqual([]);
  });

  it('cada cobertura dice QUÉ pasa, no sólo que existe', () => {
    for (const [modulo, nota] of Object.entries(COBERTURA_FUSION)) {
      expect(nota.length).toBeGreaterThan(15);
      expect(`${modulo}: ${nota}`).toMatch(/fusionado|aparte/);
    }
  });

  it('cada exclusión lleva una razón escrita, no un pase libre', () => {
    // 60 caracteres no prueban que la razón sea cierta — ninguna aserción puede.
    // Lo que descartan es el pase libre de una palabra ("caché", "no aplica"),
    // que es como se cuela una exclusión sin haberla pensado.
    for (const [modulo, razon] of Object.entries(EXCLUIDOS_FUSION)) {
      expect(`${modulo}: ${razon}`.length).toBeGreaterThan(60);
    }
  });
});

describe('(b) lo que se cachea por cuenta se suelta al cambiar de cuenta', () => {
  it('cada módulo con estado scopeado en memoria pasa por rehydrateForActiveUser', () => {
    // Sin esto, la cuenta que entra segunda en el mismo arranque lee lo de la
    // primera — y al guardar lo reescribe bajo SU scope. Es la filtración 4.
    const importes = importesDeSession();
    const cuerpo = cuerpoRehidratacion();

    const sinSoltar = modulosScopeados()
      .filter(m => m.enMemoria)
      .filter(m => !(importes.get(m.id) ?? []).some(n => new RegExp(`\\b${n}\\b`).test(cuerpo)))
      .map(m => m.id);

    expect(sinSoltar).toEqual([]);
  });
});
