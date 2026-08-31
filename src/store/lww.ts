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

/**
 * Une dos listas por id aplicando LWW. No muta las entradas.
 * Los que no estaban se agregan; los que estaban se reemplazan sólo si el
 * entrante gana.
 */
export function mergeByIdLWW<T extends Syncable>(current: T[], incoming: T[]): T[] {
  const out = [...current];
  const indexById = new Map(out.map((item, i) => [item.id, i]));

  for (const inc of incoming) {
    const i = indexById.get(inc.id);
    if (i === undefined) {
      indexById.set(inc.id, out.length);
      out.push(inc);
    } else if (incomingWins(inc, out[i]!)) {
      out[i] = inc;
    }
  }
  return out;
}
