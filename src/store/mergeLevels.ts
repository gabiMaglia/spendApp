import { canonical, type Syncable } from './lww';
import { canonicalCore, coreFieldsOf, type CoreKind, type CoreRecord } from '@/src/sync/confianza/recordCore';
import { envenenado } from './relojDelMerge';
import { unirDisputa } from '@/src/algorithms/autoria';
import { unirMiembros } from '@/src/algorithms/roster';
import type { Group, NucleoDisputado } from '@/src/types/models';

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
 * 1. **Núcleo** — lo que decide plata y autoría (`recordCore.ts`). Entre uno
 *    con firma y uno sin firma gana el que la trae (T-152); si no, gana el de
 *    `rev` mayor, que sólo sube el autor y va ADENTRO de la firma. Subirlo sin
 *    la privada del autor rompe la firma; ése es todo el mecanismo.
 * 2. **Colaborativo** — `miembros` y `autoriaDisputada`. Son aportes de gente distinta: no se eligen, se unen.
 * 3. **El resto** — `updatedAt`, `isDeleted`, el nombre del grupo, el URI local
 *    del recibo. Sigue siendo LWW por `updatedAt`, exactamente como hoy, con el
 *    tope de reloj de T-144: un `updatedAt` más de `TOLERANCIA_RELOJ_MS` en el
 *    futuro no gana.
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

/**
 * Une dos versiones de un campo colaborativo. `undefined` = el campo no está.
 *
 * `cur`/`inc` (el registro completo de cada lado) sólo los necesita
 * `unirAutoria`, para comparar `createdById` — el resto de las uniones los
 * ignora. `now` sólo lo necesita `unirMiembrosDeGrupo` (T-182), para el tope
 * de reloj (T-144) — una función con menos parámetros declarados sigue
 * siendo asignable a este tipo, así que las demás no lo mencionan.
 */
type Union = (local: unknown, remoto: unknown, cur: Registro, inc: Registro, now: number) => unknown;

/**
 * `autoriaDisputada` (T-170 · D-2, ronda 2): unión de NÚCLEOS COMPETIDORES
 * (con su firma) cuando `createdById` difiere entre versiones.
 *
 * `cur`/`inc` son los registros ENTEROS (no sólo el id): `unirDisputa` recorta
 * de ahí el snapshot firmable. El merge sigue sin verificar nada (D9) — sólo
 * captura y une por contenido; la firma se revisa afuera
 * (`src/sync/autoriaTrust.ts`).
 *
 * Es colaborativo sólo en `expense`: en `payment` no hay razón (los pagos
 * derivados de salida existieron hasta T-228), y el único poder de creador
 * sobre pagos es el atajo D3, que se cierra por otro lado (`settlementStatus`,
 * Task 3). No hay ninguna razón de negocio para disputar autoría de
 * comentarios, recurrentes o grupos hoy.
 */
const unirAutoria: Union = (local, remoto, cur, inc) =>
  unirDisputa(local as NucleoDisputado[] | undefined, remoto as NucleoDisputado[] | undefined,
    cur, inc);

/**
 * `miembros` (T-182): roster por miembro en vez de `memberIds` como lista
 * entera. Colaborativo porque, igual que las aprobaciones, es un aporte de
 * gente distinta — cada quien sólo escribe SU propia entrada
 * (`conAlta`/`conBaja`). `memberIds` no se toca acá: lo recalcula
 * `mergeGroupsPure` después de unir.
 */
const unirMiembrosDeGrupo: Union = (local, remoto, _cur, _inc, now) =>
  unirMiembros(local as Group['miembros'] | undefined, remoto as Group['miembros'] | undefined, now);

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
  expense: [['autoriaDisputada', unirAutoria]],
  payment: [],
  comment: [],
  recurring: [],
  group: [['miembros', unirMiembrosDeGrupo]],
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

/** ¿Trae firma? Por PRESENCIA, nunca por verificación: el merge no toca la curva (D9). */
function traeFirma(r: Registro): boolean {
  return typeof r.k === 'string' && r.k.length > 0 && typeof r.s === 'string' && r.s.length > 0;
}

/**
 * ¿Gana el NÚCLEO entrante?
 *
 * **Primero la firma, después el `rev`** (T-152, DEC-05 del PO; SEC-08). Un
 * núcleo SIN firma nunca le gana a uno CON firma: hasta acá bastaba un `rev`
 * gigante sin `k`/`s` para pisar el monto firmado del autor, y el resultado
 * quedaba «no verificable» —que por R1 nunca es un rechazo— en vez de
 * «inválido». La regla es simétrica para que dos teléfonos converjan desde
 * cualquier lado. No enciende la fase B: entre dos sin firma (peers
 * anteriores a T-041, registros derivados) y entre dos con firma manda el
 * `rev` como siempre. Se mira PRESENCIA de firma, no validez — una firma
 * falsa con `rev` alto sigue ganando; el veredicto queda `invalida` sólo si
 * se conoce la clave del autor, y `no_verificable` si no (`verifyCore` en
 * `recordSign.ts` corta antes de mirar la firma cuando `authorKeys` no la
 * tiene). Ese residual es el que R1 acepta.
 *
 * Consecuencia declarada: si al autor le falla firmar una edición (sin
 * privada, o `signCore` tira), esa edición no viaja por encima de su versión
 * firmada. Es lo correcto: una edición sin firma de un registro firmado es
 * indistinguible de una suplantación.
 *
 * Después, un `rev` ENVENENADO no gana (T-170 criterio 3): `rev` sale de
 * `max(syncedNow(), prev+1)` (`signOnWrite.siguienteRev`), así que uno más
 * allá de `now + TOLERANCIA_RELOJ_MS` no lo produce nadie honesto. Sin este
 * tope, Mallory pone `rev: 9e15` y el autor genuino no recupera nunca su
 * núcleo re-editando —`siguienteRev` seguiría sumando sobre ese valor—. Si
 * los dos lados están envenenados, no hay nada que proteger y manda `rev`
 * como siempre (exactamente un sentido gana, T-152).
 *
 * Después, gana `rev` mayor. Ante empate, el desempate canónico del núcleo —
 * arbitrario pero igual en los dos dispositivos, que es lo único que hace
 * falta. **Los dos sin `rev` es un caso aparte**: son registros anteriores a
 * T-041, o de un peer que no actualizó, y ahí no hay ninguna firma que
 * ordenar; manda `updatedAt`, igual que siempre.
 */
export function coreWins<K extends CoreKind>(
  kind: K, incoming: CoreRecord[K], current: CoreRecord[K], now: number,
): boolean {
  const inc = incoming as unknown as Registro;
  const cur = current as unknown as Registro;

  const firmaInc = traeFirma(inc);
  const firmaCur = traeFirma(cur);
  if (firmaInc !== firmaCur) return firmaInc;

  const revInc = revDe(inc);
  const revCur = revDe(cur);

  const venInc = envenenado(revInc, now);
  const venCur = envenenado(revCur, now);
  if (venInc !== venCur) return venCur;

  if (revInc !== revCur) return revInc > revCur;

  if (revInc === 0 && incoming.updatedAt !== current.updatedAt) {
    return incoming.updatedAt > current.updatedAt;
  }
  return canonicalCore(kind, incoming) > canonicalCore(kind, current);
}

/**
 * ¿Gana el RESTO entrante? Es el LWW de siempre, sobre los campos que le
 * quedan — con el tope de reloj de T-144 (SEC-02): un `updatedAt` que no pudo
 * haber pasado todavía no gana el desempate, y un local que ya quedó así
 * pierde contra cualquier entrante plausible. Sin esto, `isDeleted: true` con
 * `9e15` era un tombstone permanente que ninguna edición honesta revertía.
 */
function restoWins<K extends CoreKind>(
  kind: K, incoming: CoreRecord[K], current: CoreRecord[K], now: number,
): boolean {
  if (envenenado(incoming.updatedAt, now)) return false;
  if (envenenado(current.updatedAt, now)) return true;
  if (incoming.updatedAt !== current.updatedAt) {
    return incoming.updatedAt > current.updatedAt;
  }
  return canonical(restoDe(kind, incoming as unknown as Registro))
       > canonical(restoDe(kind, current as unknown as Registro));
}

/**
 * Une dos versiones del MISMO registro, nivel por nivel.
 *
 * `now` se inyecta (nunca `syncedClock` acá): el merge es puro y corre en tests
 * sin almacenamiento nativo. Los stores le pasan `syncedNow()` por default.
 */
export function mergeRecord<K extends CoreKind>(
  kind: K, current: CoreRecord[K], incoming: CoreRecord[K], now: number,
): CoreRecord[K] {
  const ganaNucleo = coreWins(kind, incoming, current, now) ? incoming : current;
  const ganaResto  = restoWins(kind, incoming, current, now) ? incoming : current;

  const cur = current as unknown as Registro;
  const inc = incoming as unknown as Registro;
  const colaborativos = COLABORATIVOS[kind]
    .map(([campo, unir]) => [campo, unir(cur[campo], inc[campo], cur, inc, now)] as const);

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
  kind: K, current: readonly CoreRecord[K][], incoming: readonly CoreRecord[K][], now: number,
): CoreRecord[K][] {
  const out = [...current];
  const indexById = new Map<string, number>(
    out.map((item, i) => [(item as unknown as Syncable).id, i]),
  );

  for (const inc of incoming) {
    const id = (inc as unknown as Syncable).id;
    const i = indexById.get(id);
    if (i === undefined) {
      // Un id nuevo con `updatedAt` envenenado no entra (T-144): si entrara,
      // nada plausible podría pisarlo después. Mismo criterio que
      // `mergeUsersLWW`. No es un descarte de datos —nadie lo persiste— sino
      // el mismo "no gana" que arriba, aplicado a un local que no existe.
      if (envenenado(inc.updatedAt, now)) continue;
      indexById.set(id, out.length);
      out.push(inc);
    } else {
      out[i] = mergeRecord(kind, out[i]!, inc, now);
    }
  }
  return out;
}
