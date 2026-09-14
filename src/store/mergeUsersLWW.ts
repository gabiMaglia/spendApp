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
 * **D2 (verificador ciego, ronda 2 de T-137).** El delta del relay se castea
 * sin validar tipos (`JSON.parse(...) as SyncDelta`, `src/sync/relaySync.ts`)
 * y `acotarDeltaAlGrupo.ts` sólo filtra por id, no por forma: un `updatedAt`
 * NO numérico (`"zzz"`, `NaN`, `null`, `undefined`) esquiva `> limiteFuturo`
 * — esa comparación nunca da `true` contra basura no numérica salvo
 * `Infinity` — y encima `incomingWins` compara con `>`, que con un string
 * nunca deja que un `updatedAt` real y numérico le gane de vuelta: la misma
 * permanencia que `9e15` motivó, por una puerta distinta. `Number.isFinite`
 * cubre los cinco casos de una sola vez (rechaza `NaN`, `Infinity`, `null`,
 * `undefined` y cualquier string, sin lista de casos especiales) y un
 * entrante/local inválido se trata exactamente como uno futuro: el entrante
 * no gana ni se agrega, el local inválido cuenta como envenenado.
 *
 * `now` se inyecta (nunca `Date.now()` ni `syncedClock` acá adentro): el
 * merge es una función pura y `syncedClock` abre almacenamiento nativo, que no
 * puede entrar al grafo de un módulo que además corre en tests.
 */
export function mergeUsersLWW<T extends Syncable>(current: T[], incoming: T[], now: number): T[] {
  const limiteFuturo = now + TOLERANCIA_RELOJ_MS;
  const envenenado = (updatedAt: number) => !Number.isFinite(updatedAt) || updatedAt > limiteFuturo;

  const out = [...current];
  const indexById = new Map(out.map((item, i) => [item.id, i]));

  for (const inc of incoming) {
    if (envenenado(inc.updatedAt)) continue; // criterio 1 + D2: futuro o no numérico, no gana ni se agrega

    const i = indexById.get(inc.id);
    if (i === undefined) {
      indexById.set(inc.id, out.length);
      out.push(inc);
      continue;
    }

    const cur = out[i]!;
    // criterio 2 + D2: local envenenado (futuro o no numérico) pierde contra cualquier entrante plausible
    if (envenenado(cur.updatedAt) || incomingWins(inc, cur)) {
      out[i] = inc;
    }
  }
  return out;
}
