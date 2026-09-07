import { existsSync, readFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';

/**
 * **La canonicalización no puede llegar al cable** (T-048 · D-5).
 *
 * `idCanonico()` traduce mis identidades viejas a la activa para que la
 * aritmética de saldos vea UNA persona y no dos. Es correcto adentro del
 * dispositivo y es una **migración destructiva** un centímetro más allá: un id
 * canonicalizado que entra a `buildDelta` o a `buildGroupPayload` sale del
 * teléfono, se propaga por LWW a peers que nunca supieron del enlace, y no se
 * puede volver atrás — el dato ya está en el aparato del otro (ADR-008 §11-A).
 * Y como `createdById` está adentro del núcleo firmado de T-041, además
 * invalidaría la firma del autor honesto.
 *
 * Por eso el invariante no es «acordate de no hacerlo»: es este test. Recorre el
 * **grafo de imports** desde los dos armadores de sobres y falla si el símbolo
 * prohibido aparece en cualquier módulo del cierre.
 *
 * **Qué se prohíbe exactamente, y qué no.** Lo prohibido es **llamar** a
 * `idCanonico()` / `rosterCanonico()` desde un módulo que el sobre alcanza. El
 * módulo de alias en sí puede estar en el grafo, y de hecho tiene que estarlo:
 * `signOnWrite` pregunta `esYo(autor)` para decidir si re-firma un gasto propio
 * escrito con la identidad vieja (D-4), y eso es correcto — **`esYo` devuelve un
 * booleano y no puede reescribir un id; `idCanonico` devuelve un id y es lo
 * único que puede**. Prohibir el módulo entero en vez del símbolo dejaría a D-4
 * sin forma de existir.
 *
 * ⚠️ **Se barre el grafo, no el texto del repo.** La diferencia importa: un
 * barrido de texto se encontraría a sí mismo —este archivo nombra `idCanonico`
 * ocho veces— y ya hubo TRES guards en este proyecto que se detectaron solos por
 * nombrar el patrón que prohíben. Acá los tests no son alcanzables desde
 * `relaySync.ts`, así que el archivo queda fuera del grafo por construcción.
 * Si alguien lo reescribe como barrido de texto, tiene que excluir `__tests__`
 * explícitamente — el patrón correcto está en
 * `src/__tests__/noHardcodedCurrency.test.ts`.
 */
const RAIZ = resolve(__dirname, '..', '..', '..');

/** Las funciones que traducen un id. Ninguna puede ser LLAMADA desde el cierre. */
const PROHIBIDOS = ['idCanonico', 'rosterCanonico'] as const;

/** Quien las define las llama por dentro; no es una ofensa. */
const DEFINIDOR = join('src', 'store', 'identityAlias.ts');

/** Las dos raíces: el sobre del relay y el delta del QR / pairing P2P. */
const RAICES = [
  join(RAIZ, 'src', 'sync', 'relaySync.ts'),   // buildGroupPayload
  join(RAIZ, 'src', 'sync', 'useSyncQR.ts'),   // buildDelta
];

const EXTENSIONES = ['.ts', '.tsx', '.js', '.jsx'];

/** `@/src/x`, `./x`, `../x` → ruta absoluta del archivo. `null` si es un paquete. */
function resolver(desde: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(RAIZ, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(desde), spec);
  else return null; // node_modules: no es código nuestro

  for (const ext of EXTENSIONES) {
    if (existsSync(base + ext)) return base + ext;
    const indice = join(base, `index${ext}`);
    if (existsSync(indice)) return indice;
  }
  return existsSync(base) ? base : null;
}

/** Los especificadores que importa un archivo (import y re-export). */
function importesDe(src: string): string[] {
  const specs: string[] = [];
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g)) {
    specs.push(m[1]!);
  }
  // `import './efectos'` y `require('...')`, que no llevan `from`.
  for (const m of src.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) specs.push(m[1]!);
  for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]!);
  return specs;
}

/** Cierre transitivo de imports desde las raíces. */
function cierre(raices: string[]): Map<string, string> {
  const visto = new Map<string, string>();
  const pila = [...raices];

  while (pila.length > 0) {
    const archivo = pila.pop()!;
    if (visto.has(archivo)) continue;
    if (!existsSync(archivo) || !/\.[jt]sx?$/.test(archivo)) continue;

    const src = readFileSync(archivo, 'utf8');
    visto.set(archivo, src);

    for (const spec of importesDe(src)) {
      const destino = resolver(archivo, spec);
      if (destino) pila.push(destino);
    }
  }
  return visto;
}

/** El código sin comentarios: un docblock que NOMBRE la función no es llamarla. */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Los módulos del cierre que LLAMAN a un traductor de ids. */
function ofensores(grafo: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [archivo, src] of grafo) {
    const ruta = relative(RAIZ, archivo);
    if (ruta === DEFINIDOR) continue;
    // La llamada, no la mención: `import { idCanonico }` sin usarlo no reescribe
    // nada, y un docblock que la nombre —como el de este archivo— tampoco.
    const codigo = sinComentarios(src);
    if (PROHIBIDOS.some(n => new RegExp(`\\b${n}\\s*\\(`).test(codigo))) out.push(ruta);
  }
  return out.sort();
}

describe('el grafo del sobre no alcanza la canonicalización', () => {
  it('ni buildGroupPayload ni buildDelta pueden llegar a idCanonico', () => {
    const ofensa = ofensores(cierre(RAICES));

    expect(
      ofensa.length === 0
        ? []
        : [
            'La canonicalización llegó al cable. Estos módulos están en el grafo de',
            'imports de buildGroupPayload/buildDelta y nombran idCanonico:',
            ...ofensa,
            '',
            'Un id canonicalizado que se publica reescribe la identidad de un',
            'registro en el teléfono de otra persona, se propaga por LWW y no se',
            'puede deshacer. Ese id tiene que salir tal cual está guardado (D-6).',
          ],
    ).toEqual([]);
  });
});

describe('el guard sirve para algo', () => {
  /**
   * **Un guard que nadie vio caer no es un guard.** Acá se lo hace caer en vez
   * de prometer que caería: se agrega una raíz artificial que sí importa el
   * módulo de alias, y el mismo análisis tiene que encontrarla.
   */
  it('detecta la ofensa cuando el import existe de verdad', () => {
    const señuelo = join(RAIZ, 'src', 'algorithms', 'calculateBalances.ts');
    const ofensa = ofensores(cierre([señuelo]));

    // `calculateBalances` es justamente el punto de entrada donde canonicalizar
    // ES correcto (ADR-008 §9), y por eso sirve de señuelo: el mismo análisis
    // que da verde sobre el sobre da rojo apenas la llamada está en el grafo.
    expect(ofensa).toContain('src/algorithms/calculateBalances.ts');
  });

  it('las dos raíces existen y el grafo no salió vacío', () => {
    // Sin esto, un rename de archivo dejaría el guard verde recorriendo la nada.
    for (const raiz of RAICES) expect(existsSync(raiz)).toBe(true);
    expect(cierre(RAICES).size).toBeGreaterThan(20);
  });
});
