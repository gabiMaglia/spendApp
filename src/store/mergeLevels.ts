import { canonical, type Syncable } from './lww';
import { canonicalCore, coreFieldsOf, type CoreKind, type CoreRecord } from '@/src/sync/recordCore';
import { mergeDeletionVoteSets } from '@/src/sync/SyncEngine';
import { mergeApprovals } from '@/src/algorithms/leaveRequest';
import type { DeletionVote, LeaveRequest } from '@/src/types/models';

/**
 * **Merge por niveles** (T-041 · S7).
 *
 * Hasta acá el merge era una sola decisión: gana el registro con `updatedAt`
 * mayor, entero. El problema es que `updatedAt` **lo escribe cualquiera** —está
 * afuera de la firma a propósito, porque el que vota un borrado no tiene la
 * privada del autor y tiene que poder tocarlo. Entonces un tercero toma un
 * núcleo firmado VÁLIDO, le re-estampa el `updatedAt` con la hora de su
 * teléfono, y le gana al merge con datos viejos. La firma sigue siendo la
 * verdadera del autor, así que **ninguna cantidad de verificación lo detecta**.
 *
 * Un registro tiene tres niveles y cada uno se resuelve con su propia regla:
 *
 * 1. **Núcleo** — lo que decide plata y autoría (`recordCore.ts`). Gana el de
 *    `rev` mayor, que sólo sube el autor y va ADENTRO de la firma. Subirlo sin
 *    la privada del autor rompe la firma; ése es todo el mecanismo.
 * 2. **Colaborativo** — `deletionVotes` y `leaveRequest.approvedBy`. Son
 *    aportes de gente distinta: no se eligen, se unen.
 * 3. **El resto** — `updatedAt`, `isDeleted`, el nombre del grupo, el URI local
 *    del recibo. Sigue siendo LWW por `updatedAt`, exactamente como hoy.
 *
 * **Esto no reemplaza el LWW: le saca una responsabilidad que nunca pudo
 * sostener.** `updatedAt` sigue ordenando la escritura, sigue filtrando el
 * delta y sigue decidiendo el tombstone (reglas #4 y #8). Lo único que deja de
 * hacer es decidir quién escribió el núcleo.
 *
 * **Acá NO se verifica ninguna firma, y es deliberado** (D9 del plan). Como el
 * PO decidió marcar y nunca rechazar (R1), el merge no necesita la firma para
 * decidir nada: ordena por `rev`, y verificar existe sólo para marcar y medir
 * (S6/S10). Medido en el teléfono del PO, una verificación cuesta ~37 ms: en el
 * camino más caliente de la app, un sobre de 500 registros serían ~19 s de hilo
 * bloqueado cada 20 segundos. `__tests__/mergeLevels.test.ts` lo exige, con
 * un espía sobre la curva y con el grafo de imports.
 */

type Registro = Record<string, unknown>;

/**
 * La firma viaja CON el núcleo aunque no esté firmada por sí misma: una `s`
 * pegada a un núcleo distinto del que firmó no verifica, y el autor honesto
 * quedaría marcado por un merge nuestro.
 */
const CAMPOS_DE_FIRMA = ['k', 's'] as const;

/** Une dos versiones de un campo colaborativo. `undefined` = el campo no está. */
type Union = (local: unknown, remoto: unknown) => unknown;

const unirVotos: Union = (local, remoto) => {
  const a = local as DeletionVote[] | undefined;
  const b = remoto as DeletionVote[] | undefined;
  if (a === undefined && b === undefined) return undefined;

  const unido = mergeDeletionVoteSets(a, b);
  // Devolver la MISMA referencia cuando no cambió nada no es cosmética: sin
  // esto cada drenado del relay produce un array nuevo para cada gasto, y con
  // él un re-render y una escritura a disco de todo, cada 20 segundos.
  return a !== undefined && mismosVotos(a, unido) ? a : unido;
};

function mismosVotos(a: readonly DeletionVote[], b: readonly DeletionVote[]): boolean {
  return a.length === b.length && a.every((v, i) => canonical(v) === canonical(b[i]));
}

const unirAprobaciones: Union = (local, remoto) => {
  const a = local as LeaveRequest | undefined;
  const unido = mergeApprovals(a, remoto as LeaveRequest | undefined);
  if (unido === a) return a;
  // `mergeApprovals` arma un pedido nuevo cada vez que une, aunque el conjunto
  // de aprobaciones no haya cambiado. Sin esta comparación, cada drenado del
  // relay produce un `Group` nuevo y con él un re-render de todo.
  return a !== undefined && unido !== undefined && canonical(unido) === canonical(a) ? a : unido;
};

/**
 * Qué campos de cada entidad son colaborativos.
 *
 * Está escrito por entidad y no derivado de la clasificación de `recordCore`
 * porque "afuera del núcleo" y "colaborativo" no son lo mismo: `updatedAt` e
 * `isDeleted` están afuera de la firma y sin embargo los sigue ordenando el
 * LWW. Colaborativo es sólo lo que **varias personas escriben a la vez** y por
 * lo tanto no se puede elegir sin perder el aporte de alguien.
 */
const COLABORATIVOS: Record<CoreKind, readonly (readonly [string, Union])[]> = {
  expense: [['deletionVotes', unirVotos]],
  payment: [],
  comment: [],
  recurring: [],
  group: [['deletionVotes', unirVotos], ['leaveRequest', unirAprobaciones]],
};

/** `rev` ausente cuenta como 0: es todo lo que existe desde antes de T-041. */
function revDe(record: Registro): number {
  return typeof record.rev === 'number' ? record.rev : 0;
}

const EXCLUIDOS_DEL_RESTO = new Map<CoreKind, ReadonlySet<string>>();

function excluidosDelResto(kind: CoreKind): ReadonlySet<string> {
  let set = EXCLUIDOS_DEL_RESTO.get(kind);
  if (!set) {
    set = new Set<string>([
      ...coreFieldsOf(kind),
      ...CAMPOS_DE_FIRMA,
      ...COLABORATIVOS[kind].map(([campo]) => campo),
    ]);
    EXCLUIDOS_DEL_RESTO.set(kind, set);
  }
  return set;
}

/**
 * El desempate del resto se calcula sobre el resto y no sobre el registro
 * entero.
 *
 * Es una condición de CONVERGENCIA, no una prolijidad: el resultado de un merge
 * por niveles es un híbrido que no es ninguno de los dos registros de entrada.
 * Si el desempate mirara el objeto completo, compararía contra un contenido que
 * depende de qué se mergeó antes, y dos dispositivos que reciben lo mismo en
 * distinto orden elegirían distinto.
 */
function restoDe(kind: CoreKind, record: Registro): Registro {
  const excluidos = excluidosDelResto(kind);
  const fuera: Registro = {};
  for (const [campo, valor] of Object.entries(record)) {
    if (!excluidos.has(campo)) fuera[campo] = valor;
  }
  return fuera;
}

/**
 * ¿Gana el NÚCLEO entrante?
 *
 * Gana `rev` mayor. Ante empate, el desempate canónico del núcleo — arbitrario
 * pero igual en los dos dispositivos, que es lo único que hace falta.
 *
 * **Los dos sin `rev` es un caso aparte y no un empate cualquiera**: son
 * registros anteriores a T-041, o de un peer que no actualizó, y ahí no hay
 * ninguna firma que ordenar. Decidirlos por contenido le daría vuelta el
 * comportamiento de hoy y las ediciones de un peer viejo dejarían de entrar. En
 * ese mundo manda `updatedAt`, igual que siempre.
 */
export function coreWins<K extends CoreKind>(
  kind: K, incoming: CoreRecord[K], current: CoreRecord[K],
): boolean {
  const inc = incoming as unknown as Registro;
  const cur = current as unknown as Registro;

  const revInc = revDe(inc);
  const revCur = revDe(cur);
  if (revInc !== revCur) return revInc > revCur;

  if (revInc === 0 && incoming.updatedAt !== current.updatedAt) {
    return incoming.updatedAt > current.updatedAt;
  }
  return canonicalCore(kind, incoming) > canonicalCore(kind, current);
}

/** ¿Gana el RESTO entrante? Es el LWW de siempre, sobre los campos que le quedan. */
function restoWins<K extends CoreKind>(
  kind: K, incoming: CoreRecord[K], current: CoreRecord[K],
): boolean {
  if (incoming.updatedAt !== current.updatedAt) {
    return incoming.updatedAt > current.updatedAt;
  }
  return canonical(restoDe(kind, incoming as unknown as Registro))
       > canonical(restoDe(kind, current as unknown as Registro));
}

/** Une dos versiones del MISMO registro, nivel por nivel. */
export function mergeRecord<K extends CoreKind>(
  kind: K, current: CoreRecord[K], incoming: CoreRecord[K],
): CoreRecord[K] {
  const ganaNucleo = coreWins(kind, incoming, current) ? incoming : current;
  const ganaResto  = restoWins(kind, incoming, current) ? incoming : current;

  const cur = current as unknown as Registro;
  const inc = incoming as unknown as Registro;
  const colaborativos = COLABORATIVOS[kind]
    .map(([campo, unir]) => [campo, unir(cur[campo], inc[campo])] as const);

  // Nada del entrante ganó nada: se devuelve el registro que ya estaba, con su
  // identidad intacta. Es el caso ABRUMADORAMENTE mayoritario —el sobre lleva
  // el estado completo del grupo y lo republica cada miembro cada 20 s— y
  // construir un objeto nuevo ahí dispara un re-render y una escritura por
  // registro y por vuelta.
  const sinCambios = ganaNucleo === current && ganaResto === current
    && colaborativos.every(([campo, valor]) => valor === cur[campo]);
  if (sinCambios) return current;

  const salida: Registro = { ...(ganaResto as unknown as Registro) };

  if (ganaNucleo !== ganaResto) {
    const nucleo = ganaNucleo as unknown as Registro;
    // Se copia el núcleo COMPLETO, y lo que el ganador no tiene se borra. Un
    // campo del perdedor que sobreviva (un `note` que el autor sacó, por
    // ejemplo) deja un núcleo que ya no es el que se firmó, y la firma que
    // viaja al lado pasaría a leerse como `invalida`: acusaríamos al autor
    // honesto de una mezcla que hicimos nosotros.
    for (const campo of [...coreFieldsOf(kind), ...CAMPOS_DE_FIRMA]) {
      if (nucleo[campo] === undefined) delete salida[campo];
      else salida[campo] = nucleo[campo];
    }
  }

  for (const [campo, valor] of colaborativos) {
    if (valor === undefined) delete salida[campo];
    else salida[campo] = valor;
  }

  return salida as unknown as CoreRecord[K];
}

/**
 * Une dos listas por id aplicando el merge por niveles. No muta las entradas.
 *
 * Es el reemplazo de `mergeByIdLWW` para las cinco entidades con núcleo
 * firmable. `users` y `personal` siguen con el LWW liso: no tienen núcleo
 * económico ni firma, así que no hay niveles que separar.
 */
export function mergeByIdLevels<K extends CoreKind>(
  kind: K, current: readonly CoreRecord[K][], incoming: readonly CoreRecord[K][],
): CoreRecord[K][] {
  const out = [...current];
  const indexById = new Map<string, number>(
    out.map((item, i) => [(item as unknown as Syncable).id, i]),
  );

  for (const inc of incoming) {
    const id = (inc as unknown as Syncable).id;
    const i = indexById.get(id);
    if (i === undefined) {
      indexById.set(id, out.length);
      out.push(inc);
    } else {
      out[i] = mergeRecord(kind, out[i]!, inc);
    }
  }
  return out;
}
