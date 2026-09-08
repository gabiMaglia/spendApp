import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from '@/src/store/userScope';
import { PENDIENTE_DRENAJE_BASE } from '@/src/store/accountLink';
import { deriveTopic, fromHex } from './envelopeCrypto';

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
 * Marca un grupo como pendiente de drenaje **y olvida su cursor**.
 *
 * `topic` es opcional porque el llamador no siempre lo tiene a mano; cuando lo
 * tiene, hay que pasarlo — sin eso la relectura desde 0 no ocurre (ver arriba).
 */
export function marcarPendienteDeDrenaje(groupId: string, topic?: string): void {
  const set = leer();
  set.add(groupId);
  guardar(set);
  if (topic) olvidarCursorDe(topic);
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
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { olvidarCursor } = require('./relayEngine') as typeof import('./relayEngine');
    olvidarCursor(topic);
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
