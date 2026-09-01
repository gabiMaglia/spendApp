import { canonicalCore, type CoreKind, type CoreRecord } from './recordCore';
import { signCore } from './recordSign';
import { privadaDelAparato } from './devicePrivateKey';
import { activeUserId } from '@/src/store/userScope';
import { syncedNow } from '@/src/utils/syncedClock';

/**
 * **Firmar al escribir** (T-041 · S5).
 *
 * Es el único lugar del proyecto que le pone `k`/`s`/`rev` a un registro. Vive
 * en el punto de escritura de los stores —no en las pantallas— porque un gasto
 * no se crea desde un solo lado: `new.tsx`, el escaneo de recibo y las
 * recurrentes terminan todos en `addExpense`. Firmar en las pantallas dejaría
 * caminos sin firmar y nadie se enteraría hasta que la medición de S6 mostrara
 * un `no_verificable` inexplicable.
 *
 * **Nadie verifica todavía.** S5 sólo escribe la firma; el gate de verificación
 * es S6 y el merge por niveles es S7. Hasta entonces esto es aditivo: un peer
 * que no actualizó ignora los tres campos nuevos y mergea como siempre.
 *
 * Tres reglas, y las tres tienen consecuencia:
 *
 * 1. **Sólo se firma lo propio.** Firmar un registro cuyo autor no soy yo es
 *    declarar autoría ajena — justo lo que el ticket existe para detectar.
 * 2. **Editar re-firma; que un tercero toque el registro, no.** El núcleo lo
 *    reescribe únicamente su autor. Lo colaborativo (`updatedAt`, `isDeleted`,
 *    `deletionVotes`, …) está AFUERA de la firma a propósito, así que un voto de
 *    borrado de un tercero deja la firma del autor intacta y válida. Si eso se
 *    rompiera, el borrado consensuado se caería el primer día.
 * 3. **La firma no puede romper la creación.** Si no hay identidad, o el módulo
 *    no está en el build, el registro se guarda igual **sin** firma y queda
 *    `no_verificable`. Nunca se le bloquea al usuario cargar plata por un
 *    problema de criptografía.
 */

/**
 * Quién es el autor, por entidad.
 *
 * `ExpenseComment` no tiene `createdById`: su autor es `authorId`. Escribirlo a
 * mano por entidad y no adivinar con `record.createdById ?? record.authorId` es
 * deliberado — el fallback silencioso haría que una entidad futura sin ninguno
 * de los dos campos "no sea de nadie" y se firmara igual.
 */
const CAMPO_AUTOR: Record<CoreKind, string> = {
  expense: 'createdById',
  payment: 'createdById',
  comment: 'authorId',
  recurring: 'createdById',
  group: 'createdById',
};

export function authorOf<K extends CoreKind>(kind: K, record: CoreRecord[K]): string | undefined {
  const valor = (record as unknown as Record<string, unknown>)[CAMPO_AUTOR[kind]];
  return typeof valor === 'string' && valor !== '' ? valor : undefined;
}

function esMio<K extends CoreKind>(kind: K, record: CoreRecord[K]): boolean {
  const uid = activeUserId();
  return uid !== null && authorOf(kind, record) === uid;
}

function sinFirma<K extends CoreKind>(record: CoreRecord[K]): CoreRecord[K] {
  const copia = { ...(record as object) } as Record<string, unknown>;
  delete copia.k;
  delete copia.s;
  return copia as unknown as CoreRecord[K];
}

/**
 * Firma el núcleo, o devuelve el registro sin firma si no se pudo.
 *
 * `rev` ya viene puesto por el llamador y se conserva aunque la firma falle: es
 * lo que ordena las revisiones del núcleo en S7, y un registro editado que
 * perdiera su `rev` podría quedar por debajo de su propia versión anterior y
 * revertirle la edición al usuario. Que `rev` sea confiable no viene de que
 * exista sino de que esté ADENTRO de una firma válida — subirlo sin la privada
 * del autor rompe la firma, que es exactamente el punto.
 */
function firmar<K extends CoreKind>(kind: K, record: CoreRecord[K]): CoreRecord[K] {
  const priv = privadaDelAparato();
  if (!priv) return sinFirma(record);

  try {
    return { ...record, ...signCore(kind, record, priv) };
  } catch {
    // Una firma vieja pegada a un núcleo nuevo se leería como suplantación y
    // acusaría al autor honesto. Sin firma es `no_verificable`, que es la
    // verdad: no se pudo saber.
    return sinFirma(record);
  }
}

/** Un `rev` estrictamente mayor que el anterior, incluso dentro del mismo ms. */
function siguienteRev(previo: number | undefined): number {
  return Math.max(syncedNow(), (previo ?? 0) + 1);
}

/**
 * Al crear. Devuelve el registro firmado, o el mismo si no es mío o no se pudo.
 *
 * Los registros DERIVADOS —los pagos que `applyLeave` emite en nombre del que
 * se va— no pasan por acá: su `createdById` puede coincidir con la sesión (si
 * el que resuelve es el propio saliente) y quedarían firmados en un teléfono y
 * sin firma en todos los demás, para el mismo id. Su modelo es `derivedFrom` y
 * es S9; hasta entonces el llamador los marca y no se firman.
 */
export function signOnCreate<K extends CoreKind>(kind: K, record: CoreRecord[K]): CoreRecord[K] {
  if (!esMio(kind, record)) return record;
  return firmar(kind, { ...record, rev: siguienteRev(record.rev) });
}

/**
 * ¿Cambió el núcleo entre las dos versiones?
 *
 * `rev` es parte del núcleo, pero acá se compara tal cual y no fijado: quien
 * llama arma `siguiente` como `{...previo, ...patch}` y **el patch nunca trae
 * `rev`** —quién es el próximo lo decide esta función, no el llamador—, así que
 * los dos lados entran con el mismo. Si algún día un patch trajera uno propio,
 * comparar tal cual lo trata como cambio de núcleo y se re-firma, que es la
 * respuesta correcta: un `rev` nuevo sin firma nueva no vale nada.
 *
 * No fijar el `rev` del previo en los dos lados es deliberado: esa versión era
 * una defensa que ningún llamador podía disparar y que ninguna mutación tumbaba.
 */
function nucleoCambio<K extends CoreKind>(
  kind: K, previo: CoreRecord[K], siguiente: CoreRecord[K],
): boolean {
  return canonicalCore(kind, siguiente) !== canonicalCore(kind, previo);
}

/**
 * Al editar. `siguiente` es el registro ya con el patch y el `updatedAt` nuevo.
 *
 * Se re-firma sólo si **soy el autor** y el cambio tocó el **núcleo**. Los dos
 * filtros importan:
 *
 * - Sin el primero, el device de un tercero que vota un borrado re-firmaría el
 *   gasto de otro con SU clave y le robaría la autoría en silencio.
 * - Sin el segundo, un voto del propio autor movería `rev` sin que el contenido
 *   cambie, y en S7 esa revisión fantasma le ganaría a una edición real hecha
 *   desde su otro teléfono.
 */
export function signOnEdit<K extends CoreKind>(
  kind: K, previo: CoreRecord[K], siguiente: CoreRecord[K],
): CoreRecord[K] {
  if (!esMio(kind, siguiente)) return siguiente;
  if (!nucleoCambio(kind, previo, siguiente)) return siguiente;

  return firmar(kind, { ...siguiente, rev: siguienteRev(previo.rev) });
}
