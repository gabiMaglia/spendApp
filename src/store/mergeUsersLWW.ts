import { incomingWins, type Syncable } from './lww';
import { TOLERANCIA_RELOJ_MS } from '@/src/sync/voteCore';

/**
 * LWW de perfiles con tope de reloj (T-137, ADR-012 opción 1).
 *
 * Residual D3 de T-132 (`engram/qa/T-132-verifier.md` vuelta 2): `mergeByIdLWW`
 * genérico (`lww.ts`) es LWW puro por `updatedAt`, sin techo. Un co-miembro
 * manda un perfil con `updatedAt: 9e15` y gana para siempre — la próxima
 * edición real del dueño (`syncedNow()`, `src/store/miPerfil.ts`) nunca va a
 * superar eso. Esto volvía falsa la premisa «reversible» que T-091 declaró
 * como parte del riesgo aceptado (`src/store/userStore.ts:70-77`).
 *
 * Mismo criterio que `enElFuturo` para los votos de borrado
 * (`src/sync/voteCore.ts:65-67`): un `updatedAt` más de `TOLERANCIA_RELOJ_MS`
 * por delante de `now` no pudo haber pasado todavía, así que:
 *
 *  1. Un ENTRANTE futuro no gana — ni reemplaza a uno local, ni se agrega si
 *     el id era nuevo. No se descarta como dato (nadie lo persiste, pero
 *     tampoco es un error): simplemente pierde el desempate por fecha, como
 *     el voto no aplicado.
 *  2. Un LOCAL que ya quedó en el futuro (vandalizado antes de este fix)
 *     pierde contra CUALQUIER entrante no futuro, aunque el `updatedAt` del
 *     entrante sea numéricamente MENOR — es la parte que sanea lo ya
 *     envenenado, porque si se siguiera comparando por número el local
 *     absurdo seguiría ganando.
 *
 * `now` se inyecta (nunca `Date.now()` ni `syncedClock` acá adentro): el
 * merge es una función pura y `syncedClock` abre almacenamiento nativo, que no
 * puede entrar al grafo de un módulo que además corre en tests.
 */
export function mergeUsersLWW<T extends Syncable>(current: T[], incoming: T[], now: number): T[] {
  const limiteFuturo = now + TOLERANCIA_RELOJ_MS;
  const out = [...current];
  const indexById = new Map(out.map((item, i) => [item.id, i]));

  for (const inc of incoming) {
    if (inc.updatedAt > limiteFuturo) continue; // criterio 1: el futuro no gana ni se agrega

    const i = indexById.get(inc.id);
    if (i === undefined) {
      indexById.set(inc.id, out.length);
      out.push(inc);
      continue;
    }

    const cur = out[i]!;
    const curEsFuturo = cur.updatedAt > limiteFuturo;
    // criterio 2: local ya envenenado pierde contra cualquier entrante plausible
    if (curEsFuturo || incomingWins(inc, cur)) {
      out[i] = inc;
    }
  }
  return out;
}
