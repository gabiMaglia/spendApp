import { envenenado } from './relojDelMerge';

/**
 * Merge Last-Write-Wins compartido por todos los stores.
 *
 * Existía copiado en 7 stores, y con un defecto en todas las copias: ante empate
 * de `updatedAt` ganaba siempre el registro LOCAL. Eso hace que dos devices que
 * editan el mismo registro en el mismo milisegundo se queden cada uno con SU
 * versión **para siempre** — un sync posterior no lo resuelve, porque los
 * timestamps siguen empatados. Divergencia permanente y silenciosa.
 *
 * Acá el empate se rompe por CONTENIDO, de forma determinista: los dos devices
 * comparan la misma cosa y llegan al mismo ganador sin coordinarse. Es el mismo
 * criterio de determinismo que usan `buildSplits` (orden por userId) y los ids
 * de los gastos recurrentes.
 */

export type Syncable = { id: string; updatedAt: number };

/**
 * Serialización estable: `JSON.stringify` no garantiza orden de claves entre
 * objetos construidos distinto, y acá la comparación tiene que dar igual en los
 * dos dispositivos.
 *
 * Exportada desde T-041: es también lo que se firma (`src/sync/recordCore.ts`).
 * Reusar ésta y no escribir una segunda es deliberado — dos dispositivos ya
 * dependen de que dé igual en los dos para desempatar el LWW, así que ya está
 * probada contra el único requisito que importa. **Si cambia, cambia
 * `CORE_VERSION`**: las firmas viejas se siguen verificando con el algoritmo
 * viejo, no se rompen en silencio.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

/**
 * ¿Gana el entrante sobre el que ya estaba?
 * Mayor `updatedAt` gana. Ante empate, gana el de contenido canónico mayor —
 * arbitrario pero IGUAL en los dos devices, que es lo único que importa para
 * que converjan.
 */
export function incomingWins<T extends Syncable>(incoming: T, current: T): boolean {
  if (incoming.updatedAt !== current.updatedAt) {
    return incoming.updatedAt > current.updatedAt;
  }
  return canonical(incoming) > canonical(current);
}

export type OpcionesMergeLWW = {
  /**
   * PO 2026-09-26 (T-171, fix ronda 1) — «agregar, pero no pisar».
   *
   * Sólo `personal` (vía `mergePersonalPure`) la activa. Ahí el riesgo típico
   * es un reloj PROPIO adelantado (el dueño es el único que escribe), no un
   * atacante externo con un `updatedAt` inventado — y perder un movimiento
   * personal es peor que dejarlo temporalmente "envenenado". Por eso, con
   * esta opción activa, un entrante envenenado cuyo id es NUEVO se agrega
   * igual (nunca se pierde), aunque uno cuyo id YA EXISTE sigue sin poder
   * reemplazar al local (no hay forma de distinguir ahí "mi reloj se
   * adelantó" de "alguien más me mandó basura").
   *
   * `users` (perfiles) deja esta opción en su default (`false`): ahí el
   * escritor no es sólo el dueño — cualquier co-miembro puede mandar un
   * perfil ajeno por el relay (T-137) — así que un `updatedAt` envenenado
   * con id nuevo no se agrega, punto. Cambiar esto para `users` reabriría
   * exactamente el ataque que T-137/D2 cerró.
   */
  agregarNuevosEnvenenados?: boolean;
};

/**
 * Une dos listas por id aplicando LWW, con tope de reloj (T-171,
 * generaliza T-137/T-144). No muta las entradas.
 *
 * Sin tope, un `updatedAt: 9e15` ganaba el desempate para siempre: ninguna
 * edición honesta futura (`syncedNow()`) puede superarlo numéricamente. La
 * regla base (con `opts` en default) es la misma que ya usaban
 * `relojDelMerge.ts`/`mergeUsersLWW.ts`:
 *
 *  1. Un ENTRANTE envenenado (futuro, o `updatedAt` no numérico/no finito)
 *     no gana ni se agrega si el id era nuevo.
 *  2. Un LOCAL que ya quedó envenenado (vandalizado antes de este fix) pierde
 *     contra cualquier entrante plausible, aunque su `updatedAt` sea
 *     numéricamente menor — es lo que autocura un registro ya vandalizado.
 *
 * Con `opts.agregarNuevosEnvenenados` (ver ese tipo) la regla 1 se relaja
 * SÓLO para el caso de id nuevo: un entrante envenenado con id nuevo se
 * agrega en vez de descartarse. Un entrante envenenado con id EXISTENTE
 * nunca reemplaza al local, con o sin la opción — eso no cambia.
 *
 * `now` se inyecta (nunca `Date.now()`/`syncedClock` acá adentro): módulo
 * puro, igual que `relojDelMerge.ts`.
 */
export function mergeByIdLWW<T extends Syncable>(
  current: T[],
  incoming: T[],
  now: number,
  opts?: OpcionesMergeLWW,
): T[] {
  const agregarNuevosEnvenenados = opts?.agregarNuevosEnvenenados ?? false;
  const out = [...current];
  const indexById = new Map(out.map((item, i) => [item.id, i]));

  for (const inc of incoming) {
    const incEnvenenado = envenenado(inc.updatedAt, now);
    const i = indexById.get(inc.id);

    if (i === undefined) {
      if (incEnvenenado && !agregarNuevosEnvenenados) continue; // id nuevo + envenenado: no se agrega
      indexById.set(inc.id, out.length);
      out.push(inc);
      continue;
    }

    if (incEnvenenado) continue; // envenenado nunca reemplaza a un id existente

    const cur = out[i]!;
    // local envenenado pierde contra cualquier entrante plausible (autocura)
    if (envenenado(cur.updatedAt, now) || incomingWins(inc, cur)) {
      out[i] = inc;
    }
  }
  return out;
}
