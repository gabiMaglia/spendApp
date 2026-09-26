/**
 * **La autoría no se gana, se disputa** (T-170 · D-2).
 *
 * §2 del plan: ningún orden total sobre el contenido del núcleo distingue al
 * autor genuino del falso. Mallory controla `rev`, `createdAt` y todo el resto
 * del núcleo; lo único que no controla es su propio id, y los ids los genera
 * el cliente (regla 5), así que elegir uno lexicográficamente chico es gratis.
 * Las dos firmas verifican, cada una con su autor. La verdad está en la
 * HISTORIA («quién fue primero»), y el merge por estado no la tiene.
 *
 * Conclusión: dentro del merge lo único convergente es REGISTRAR que hay
 * disputa — una unión monótona, conmutativa, asociativa e idempotente — y lo
 * que se decide con esa disputa (§5 I-10: ningún `forced` inmediato, ni
 * siquiera del autor genuino) vive afuera, en `forcedTrust` (T-169).
 *
 * No se compara con `mismaPersona` (alias local): leería estado del
 * dispositivo y dos aparatos con distinto directorio de alias divergirían.
 * Se compara el string pelado del `createdById`, que es lo único que el merge
 * puede garantizar igual en todos lados (G9: el tope evita que un registro
 * crezca sin límite con ids basura).
 *
 * Módulo puro (I-1): sin imports de valor en runtime, para que el meta-test
 * del grafo de `mergeLevels.ts` siga en verde.
 */

export const MAX_AUTORIA_DISPUTADA = 8;
export const MAX_LARGO_ID_DISPUTA = 128;

/** Filtra lo que no puede ser un id de autor y aplica el tope determinista. */
export function normalizarDisputa(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const limpios = ids.filter(
    (x): x is string => typeof x === 'string' && x.length > 0 && x.length <= MAX_LARGO_ID_DISPUTA,
  );
  return [...new Set(limpios)].sort().slice(0, MAX_AUTORIA_DISPUTADA);
}

/**
 * Unión monótona de dos versiones de `autoriaDisputada`, más los autores que
 * trae cada núcleo cuando difieren entre sí.
 *
 * Devuelve la MISMA referencia de `local` cuando el resultado no cambia — el
 * mismo motivo que `unirVotos`/`unirAcuses` en `mergeLevels.ts`: sin esto,
 * cada drenado del relay produce un array nuevo por gasto y dispara un
 * re-render y una escritura a disco cada 20 segundos.
 */
export function unirDisputa(
  local: readonly string[] | undefined,
  remoto: readonly string[] | undefined,
  autorLocal: unknown,
  autorRemoto: unknown,
): string[] | undefined {
  const base: unknown[] = [...(local ?? []), ...(remoto ?? [])];
  if (
    typeof autorLocal === 'string' && typeof autorRemoto === 'string' && autorLocal !== autorRemoto
  ) {
    base.push(autorLocal, autorRemoto);
  }

  const out = normalizarDisputa(base);
  if (out.length === 0) return undefined;
  if (local !== undefined && local.length === out.length && local.every((v, i) => v === out[i])) {
    return local as string[];
  }
  return out;
}

/**
 * Hay disputa cuando el conjunto normalizado tiene más de un autor. Un
 * atacante que inyecta basura o ids repetidos no logra abrir una disputa: se
 * cuenta sobre lo normalizado, no sobre el largo bruto del array.
 */
export function enDisputa(e: { autoriaDisputada?: readonly string[] }): boolean {
  return normalizarDisputa(e.autoriaDisputada).length > 1;
}
