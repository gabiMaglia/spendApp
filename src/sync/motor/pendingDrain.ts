import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from '@/src/store/userScope';
import { PENDIENTE_DRENAJE_BASE } from '@/src/store/accountLink';
import { deriveTopic, fromHex } from '@/src/sync/nucleo/envelopeCrypto';
import { olvidarCursor } from './cursor';

/**
 * **No se publica un grupo hasta haberlo drenado al menos una vez** (T-089).
 *
 * `mergeByIdLWW` es **una unión, nunca una resta** (`src/store/lww.ts`). Si el
 * teléfono de alguien que reingresa a un grupo publica antes de drenar, manda el
 * estado completo que él recuerda —regla #8, el sobre lleva estado— y **un gasto
 * que el grupo borró mientras estuvo afuera vuelve a la vida en el teléfono de
 * todos**, con un `updatedAt` nuevo que le gana al tombstone.
 *
 * No hace falta que la persona haga nada raro: alcanza con que abra la app y
 * toque algo antes de que termine el drenaje. `doStartRelay` llama a `drainAll()`
 * recién después de resolver invitaciones, suscribirse a topics y anunciar la
 * tarjeta de contacto — varios `await` de red —, y varios caminos publican con
 * `delay = 0`, sin debounce.
 *
 * ⚠️ **La mitad que hace que esto sirva de algo: se olvida el cursor.**
 * `cursor::<topic>` sobrevive a la salida del grupo, así que al reingresar
 * `drainNow` pediría `seq > cursor_viejo` y podría volver con **cero sobres** —
 * la marca se limpiaría sin haber aprendido nada y el teléfono publicaría su
 * estado viejo igual. La guarda quedaría de adorno. Por eso marcar **también**
 * olvida el cursor, forzando una relectura desde 0: es idempotente, y es
 * exactamente para lo que `olvidarCursor` existe.
 *
 * **Qué NO hace, y es deliberado** (`engram/plans/T-089.md §3.5`): no bloquea
 * nada local —se cargan gastos y se ven balances igual—, y **no tiene plazo**.
 * Un «después de N intentos publicá igual» convertiría el invariante en una
 * carrera: bastaría con estar sin red el rato suficiente para que la
 * resurrección pase igual, y encima sin poder reproducirla. El drenaje ya se
 * reintenta solo por tres caminos que existen (el aviso realtime, el poll de
 * 20 s y el retorno del background), así que sin red el grupo espera y con la
 * primera ventana de red drena y publica todo junto. **Nada se pierde: se
 * posterga.**
 */

const storage = createSecureStorage('groupkeys');

/** Scopeado por cuenta: la membresía de un grupo es de la cuenta, no del aparato. */
function leer(): Set<string> {
  const raw = readScoped(storage, PENDIENTE_DRENAJE_BASE);
  if (!raw) return new Set();
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? new Set(v.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    // Dato corrupto: se degrada a "ninguno pendiente", que es el comportamiento
    // de antes de T-089. Nunca al revés — un grupo trabado para siempre por una
    // clave rota sería peor que el defecto que esto cierra.
    return new Set();
  }
}

function guardar(set: Set<string>): void {
  writeScoped(storage, PENDIENTE_DRENAJE_BASE, JSON.stringify([...set]));
}

/**
 * Generación por grupo (T-191, hallazgo M3, verifier tercera tanda) — EN
 * MEMORIA, no persistida: sólo hace falta distinguir "esta marca es más
 * nueva que la que había cuando arrancó tal drenaje", DENTRO de la sesión
 * corriendo de la app. Sube cada vez que `marcarPendienteDeDrenaje` marca un
 * grupo. `drainNow` (`relay/drain.ts`) la lee al ARRANCAR y la vuelve a
 * comparar antes de escribir el cursor / limpiar la marca — si cambió
 * mientras esperaba la red (p. ej. un `applyBackup` corrió y volvió a
 * marcar pendiente ESE MISMO grupo), ese drenaje viene de un mundo que el
 * reset ya dejó atrás y no debe pisarlo.
 */
const generaciones = new Map<string, number>();

/** Generación vigente de un grupo — 0 si nunca se marcó pendiente. */
export function generacionDePendiente(groupId: string): number {
  return generaciones.get(groupId) ?? 0;
}

/**
 * Marca un grupo como pendiente de drenaje **y olvida su cursor**.
 *
 * `topic` es opcional porque el llamador no siempre lo tiene a mano; cuando lo
 * tiene, hay que pasarlo — sin eso la relectura desde 0 no ocurre (ver arriba).
 */
export function marcarPendienteDeDrenaje(groupId: string, topic?: string): void {
  const set = leer();
  set.add(groupId);
  guardar(set);
  generaciones.set(groupId, (generaciones.get(groupId) ?? 0) + 1);
  if (topic) {
    olvidarCursorDe(topic);
    // T-191 (spec §7/§8 C5(b)): reingreso a un grupo también olvida el ledger
    // LOCAL de cubos publicados de ese topic. Sin esto, la próxima
    // publicación creería que casi todo sigue "al día" (el ledger no sabe
    // que se salió y volvió a entrar) y mandaría sólo el manifiesto sobre un
    // buzón que, del lado del emisor, hay que republicar entero.
    olvidarLedgerDe(topic);
  }
}

/**
 * Marca varios grupos resolviendo el topic de cada uno.
 *
 * **Los dos `require` son perezosos a propósito**, y no por gusto: los llamadores
 * son `groupKeyStore` y `groupStore`, y `relayEngine` importa a los dos. Un
 * import estático acá cerraría el ciclo. Es el mismo patrón que usa
 * `src/sync/ownerPledge.ts` y por la misma razón.
 *
 * No lanza: se llama desde caminos de escritura de stores, y una marca que no se
 * pudo poner no puede impedir que el usuario salga de un grupo. **El costo de
 * fallar acá está declarado**: sin la marca, ese grupo podría publicar antes de
 * drenar — o sea el defecto de T-089 para ese caso puntual.
 */
export async function marcarConTopic(groupIds: string[]): Promise<void> {
  for (const groupId of groupIds) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useGroupKeyStore } = require('@/src/store/groupKeyStore') as typeof import('@/src/store/groupKeyStore');
      const record = useGroupKeyStore.getState().getKey(groupId);
      const topic = record ? await deriveTopic(fromHex(record.key), record.epoch) : undefined;
      marcarPendienteDeDrenaje(groupId, topic);
    } catch {
      /* la marca es lo importante; el topic es la mejora */
      try { marcarPendienteDeDrenaje(groupId); } catch { /* … */ }
    }
  }
}

function olvidarCursorDe(topic: string): void {
  // T-206-A (D15): antes pedía `./relayEngine` con `require` perezoso sólo
  // para evitar un ciclo que no existe — `olvidarCursor` vive en
  // `motor/cursor.ts`, una hoja sin imports de sync (spec §2.2 V11). Import
  // estático directo.
  try {
    olvidarCursor(topic);
  } catch {
    /* … */
  }
}

/**
 * Perezoso por el mismo motivo que `olvidarCursorDe`: evita el ciclo con
 * `adaptadorHushSplit` (stores). Olvida las DOS memorias locales de T-191
 * que dependen del topic — el ledger de lo que YO publiqué (emisor,
 * `sliceLedger.ts`) y lo que ya di por APLICADO de cada emisor
 * (`appliedSlices.ts`, Task 3, spec §8 C5(c)/(d)): un reingreso al grupo es
 * "este topic es zona nueva" para las dos igual — sin borrar la segunda, un
 * manifiesto futuro con las mismas ckeys (o un `[]` de limpieza) se daría por
 * cumplido contra aplicaciones de antes de haberse ido.
 */
function olvidarLedgerDe(topic: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { olvidarTopic } = require('@/src/sync/nucleo/sliceLedger') as typeof import('@/src/sync/nucleo/sliceLedger');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { olvidarTopic: olvidarAplicadas } = require('@/src/sync/nucleo/appliedSlices') as typeof import('@/src/sync/nucleo/appliedSlices');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { almacen } = require('@/src/sync/adaptadores/hushsplit/adaptadorHushSplit') as typeof import('@/src/sync/adaptadores/hushsplit/adaptadorHushSplit');
    olvidarTopic(almacen, topic);
    olvidarAplicadas(almacen, topic);
  } catch {
    /* … */
  }
}

export function estaPendienteDeDrenaje(groupId: string): boolean {
  return leer().has(groupId);
}

/**
 * Se llama cuando el drenaje llegó al final del buzón, **aunque no haya
 * aplicado nada**: un buzón vacío es una respuesta válida. Lo que no puede
 * limpiar la marca es un drenaje que falló.
 */
export function limpiarPendienteDeDrenaje(groupId: string): void {
  const set = leer();
  if (!set.delete(groupId)) return;
  guardar(set);
}

/** Sólo para diagnóstico y tests. */
export function gruposPendientesDeDrenaje(): string[] {
  return [...leer()].sort();
}

/**
 * Suelta la caché en memoria de generaciones (guard `accountCoverage.test.ts`,
 * misma clase de bug que las cachés de T-041/T-146): los `groupId` son por
 * cuenta, y una cuenta que entra después de otra en el mismo arranque no
 * puede heredar las generaciones de la anterior. Se llama desde
 * `rehydrateForActiveUser` (`src/store/session.ts`).
 */
export function olvidarGeneraciones(): void {
  generaciones.clear();
}
