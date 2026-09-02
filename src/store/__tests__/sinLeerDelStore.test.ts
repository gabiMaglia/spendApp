import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * **Nadie selecciona un método del store y lo llama en el render.**
 *
 * ```ts
 * const n = useAlgunStore(s => s.algunMetodo)();   // ← esto
 * ```
 *
 * Está roto de dos formas a la vez y las dos son invisibles leyendo el código:
 *
 * 1. **La suscripción es a la FUNCIÓN**, cuya referencia nunca cambia. Esa
 *    suscripción no dispara un re-render jamás. Si el componente se redibuja
 *    es por otra suscripción suya, de casualidad — y el día que esa otra se
 *    saque, el número se congela sin que nada falle.
 * 2. **El método lee `get()` durante el render**, salteándose el snapshot
 *    suscrito. Con varias instancias del mismo componente montadas a la vez,
 *    cada una puede renderizar contra un estado distinto. El PO lo vio:
 *    contadores de avisos distintos en tabs distintas.
 *
 * **Este guard existe porque el test de comportamiento NO alcanza.** Se
 * escribieron 9 tests que montan dos tabs y verifican que el contador coincida
 * y se mueva junto: con el patrón roto **pasan igual**, porque jest no
 * reproduce el rendering concurrente donde el tearing aparece. Lo único que
 * distingue las dos implementaciones es la forma.
 */
const RAIZ = join(__dirname, '..', '..', '..');

/** `useLoQueSea(s => s.metodo)()` — seleccionar y llamar en el acto. */
const SELECCIONA_Y_LLAMA = /use[A-Z]\w*\(\s*\w+\s*=>\s*\w+\.\w+\s*\)\s*\(/;

function fuentes(dir: string, out: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (nombre === 'node_modules' || nombre === '__tests__' || nombre.startsWith('.')) continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) fuentes(ruta, out);
    else if (/\.tsx?$/.test(nombre)) out.push(ruta);
  }
  return out;
}

describe('el estado derivado se selecciona, no se calcula en el render', () => {
  it('ningún componente selecciona un método del store y lo invoca', () => {
    const culpables: string[] = [];

    for (const ruta of [...fuentes(join(RAIZ, 'src')), ...fuentes(join(RAIZ, 'app'))]) {
      readFileSync(ruta, 'utf8').split('\n').forEach((linea, i) => {
        // Los comentarios quedan afuera: este archivo y el docblock de
        // `useUnreadNoticeCount` NOMBRAN el patrón para explicar por qué está
        // mal, y un guard que se tropieza con su propia explicación enseña a
        // borrar la explicación. Ya pasó con el de `@noble`.
        const codigo = linea.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
        if (SELECCIONA_Y_LLAMA.test(codigo)) {
          culpables.push(`${ruta.slice(RAIZ.length + 1)}:${i + 1}`);
        }
      });
    }

    expect(culpables).toEqual([]);
  });
});
