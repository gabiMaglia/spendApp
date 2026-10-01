import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * R9 (T-182) — `Group.memberIds` es derivado de `Group.miembros`
 * (`src/algorithms/roster.ts`, `rosterDe`). Nadie arma un `Group` con un
 * `memberIds` HECHO A MANO (lista propia, `[...group.memberIds, x]`,
 * `.filter(...)`) fuera de `roster.ts`.
 *
 * Un grep de texto no distingue "`Group.memberIds`" de "un campo que se
 * LLAMA memberIds en otro tipo" (`RecurringExpense.memberIds` es su propia
 * lista de participantes, no deriva de nada acá) ni de una declaración de
 * tipo (`memberIds: string[]` en una firma o interfaz). Por eso el tope no es
 * "cero ocurrencias de `memberIds:` fuera de roster.ts" sino una
 * ALLOWLIST explícita y auditada a mano: cada entrada de abajo se revisó una
 * vez y es o (a) una declaración de tipo, (b) el mapa de clasificación de
 * `recordCore.ts` (no una instancia), (c) el propio `memberIds` de
 * `RecurringExpense` (otra entidad), o (d) el ÚNICO punto de cada archivo que
 * asigna el resultado YA derivado de `rosterDe(...)` (la derivación en sí
 * vive en `roster.ts`; a un objeto hay que asignarle el campo en algún
 * lugar). Cualquier archivo NUEVO con `memberIds:` que no esté acá es un
 * escritor sin auditar y el test lo corta.
 */

const RAIZ = join(__dirname, '..', '..', '..');
const PERMITIDO = join(RAIZ, 'src', 'algorithms', 'roster.ts');

const PATRON_LITERAL = /\bmemberIds\s*:/;

/**
 * Rutas (relativas a la raíz del repo) donde `memberIds:` es sabido y
 * auditado. Ver el comentario de arriba para el motivo de cada una.
 */
const ALLOWLIST = new Set<string>([
  'src/types/models.ts',           // declaración de tipo: Group Y RecurringExpense
  'src/sync/confianza/recordCore.ts', // GROUP_SLOTS: mapa de clasificación, no una instancia (T-206-A: mudanza)
  'src/algorithms/buildSplits.ts', // parámetro de función (string[]), no un Group
  'src/algorithms/calculateBalances.ts', // idem
  'src/components/GroupCard.tsx',  // prop de componente (string[]), no un Group
  'src/screens/expense/hooks/useGuardarGasto.ts', // memberIds de RecurringExpense, otra entidad (T-223: salió de app/expense/new.tsx)
  'src/store/groupStore.ts',       // destructuring para IGNORARLO + el único `rosterDe(...)` del store
  'app/groups/new.tsx',            // el único `memberIds: rosterDe(miembrosIniciales)` del alta
  'src/services/groupTraspaso.ts', // el único `memberIds: rosterDe(miembrosNuevo)` del traspaso
  'src/screens/debug/datosDeDemo.ts', // `memberIds: rosterDe(miembros)` del grupo de demo (sólo DEV)
]);

function archivosFuenteBajo(dir: string): string[] {
  const out: string[] = [];
  for (const nombre of readdirSync(dir)) {
    // `test-utils/`: fixtures y helpers de test, no escritores reales (T-218
    // movió ahí los fixtures de perf, que arman grupos con `memberIds`).
    if (nombre === 'node_modules' || nombre === '__tests__' || nombre === 'test-utils' || nombre.startsWith('.')) continue;
    const ruta = join(dir, nombre);
    const st = statSync(ruta);
    if (st.isDirectory()) {
      out.push(...archivosFuenteBajo(ruta));
    } else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.(ts|tsx)$/.test(nombre)) {
      out.push(ruta);
    }
  }
  return out;
}

describe('guard: Group.memberIds es derivado — ningún escritor nuevo lo arma a mano', () => {
  it('todo archivo con memberIds: fuera de roster.ts está en la allowlist auditada', () => {
    const archivos = [
      ...archivosFuenteBajo(join(RAIZ, 'src')),
      ...archivosFuenteBajo(join(RAIZ, 'app')),
    ];

    const infractores = archivos
      .filter(ruta => ruta !== PERMITIDO)
      .filter(ruta => PATRON_LITERAL.test(readFileSync(ruta, 'utf8')))
      .map(ruta => relative(RAIZ, ruta))
      .filter(ruta => !ALLOWLIST.has(ruta));

    expect(infractores).toEqual([]);
  });

  it('roster.ts sigue siendo el único lugar que DEFINE la derivación (rosterDe)', () => {
    expect(readFileSync(PERMITIDO, 'utf8')).toMatch(/export function rosterDe/);
  });
});
