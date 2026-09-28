/**
 * Guard de frontera P15 (T-191, spec §2.4 y §8 "Frontera").
 *
 * El núcleo de publicación incremental (cubos, ledger de rebanadas
 * publicadas, rebanadas aplicadas, relectura acotada — Tasks 1-3 de
 * `engram/plans/T-191.md`) vive en `src/sync/relay/` y tiene que poder
 * mudarse algún día a una librería Nx sin conocer HushSplit: no importa los
 * stores de Zustand ni `@/src/types/models`. Lo específico de la app queda
 * en `adaptadorHushSplit.ts`, que es la ÚNICA excepción.
 *
 * **Lista cerrada, no un barrido ciego del directorio** (mismo criterio que
 * dejó el hallazgo QA de T-189 sobre el guard de `announce()`): antes de
 * T-191, `src/sync/relay/` ya tenía módulos de ORQUESTACIÓN (`publish.ts`,
 * `drain.ts`, `contactos.ts`, `invitaciones.ts`, `poll.ts`, `cursor.ts`) que
 * a propósito SÍ importan stores — arman el `groupId`/`deviceId` a partir de
 * la sesión activa y llaman al núcleo, no son parte de él. Barrer el
 * directorio entero los haría fallar por algo que no es un defecto: no son
 * el núcleo, son el pegamento. La frontera se declara nombrando los archivos
 * del núcleo — cualquier archivo nuevo de esa lista (`cubos.ts`,
 * `sliceLedger.ts`, `appliedSlices.ts`, `relecturas.ts`, según se vayan
 * creando en Tasks 1-3) queda cubierto en cuanto se agrega a `NUCLEO` acá;
 * uno que falte agregar no lo está — es el mismo costo que cualquier lista
 * cerrada, y la alternativa (todo el directorio) ya demostró romper el
 * pegamento existente.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const RELAY_DIR = join(__dirname, '..', 'relay');

/**
 * Archivos del núcleo, según se van creando. Un archivo listado acá que
 * todavía no existe (por ejemplo antes de que su Task lo cree) se saltea sin
 * fallar el test — no hace falta tocar esta lista en cada Task, sólo cuando
 * el archivo exista tiene que cumplir la frontera.
 */
const NUCLEO = [
  'cubos.ts',
  'sliceLedger.ts',
  'publicarCubos.ts',
  'appliedSlices.ts',
  'relecturas.ts',
  'documento.ts',
];

const PROHIBIDOS = [/@\/src\/store\//, /@\/src\/types\/models/];

describe('frontera núcleo/adaptador de src/sync/relay/ (P15, T-191)', () => {
  it('adaptadorHushSplit.ts existe y es la única puerta a los stores', () => {
    expect(existsSync(join(RELAY_DIR, 'adaptadorHushSplit.ts'))).toBe(true);
  });

  it('ningún archivo del núcleo importa stores ni tipos de HushSplit', () => {
    const violaciones: string[] = [];
    for (const archivo of NUCLEO) {
      const ruta = join(RELAY_DIR, archivo);
      if (!existsSync(ruta)) continue; // Task futuro todavía no lo creó
      const contenido = readFileSync(ruta, 'utf8');
      for (const patron of PROHIBIDOS) {
        if (patron.test(contenido)) violaciones.push(`${archivo}: ${patron}`);
      }
    }
    expect(violaciones).toEqual([]);
  });
});
