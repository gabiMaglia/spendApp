import { canonical } from '@/src/store/lww';
import type { NucleoDisputado } from '@/src/types/models';

/**
 * **La autoría no se gana, se disputa** (T-170 · D-2, enmienda de disputa
 * firmada — ronda 2, decisión del PO sobre el dictamen del verificador).
 *
 * §2 del plan: ningún orden total sobre el contenido del núcleo distingue al
 * autor genuino del falso. Mallory controla `rev`, `createdAt` y todo el resto
 * del núcleo; lo único que no controla es su propio id, y los ids los genera
 * el cliente (regla 5), así que elegir uno lexicográficamente chico es gratis.
 * Las dos firmas verifican, cada una con su autor. La verdad está en la
 * HISTORIA («quién fue primero»), y el merge por estado no la tiene.
 *
 * Conclusión: dentro del merge lo único convergente es REGISTRAR que hay
 * disputa. **Ronda 1** registraba sólo el `createdById` en disputa
 * (`string[]`), y el verificador la tumbó: inyectar un id suelto, sin tocar el
 * núcleo ni firmar nada, alcanzaba para abrir una disputa irreversible y
 * anónima (`T-170-verifier.md`). **Ronda 2:** lo que se une es el NÚCLEO
 * COMPETIDOR firmado (`NucleoDisputado`, `src/types/models.ts`) — los mismos
 * campos que decide `EXPENSE_SLOTS` como `'core'` en `recordCore.ts`, más
 * `k`/`s` — para que se pueda reverificar cada entrada de forma independiente,
 * AFUERA del merge (`src/sync/autoriaTrust.ts`).
 *
 * El merge SIGUE sin verificar nada (D9): sólo filtra por FORMA (¿tiene la
 * forma de un núcleo firmado?) y une por CONTENIDO. Aceptar una entrada con
 * forma pero firma basura no es un problema de convergencia — es exactamente
 * lo que `autoriaTrust.ts` existe para filtrar, con el verificador que acá no
 * puede tocar (D9 / I-1).
 *
 * No se compara con `mismaPersona` (alias local): leería estado del
 * dispositivo y dos aparatos con distinto directorio de alias divergirían.
 * Se compara el string pelado del `createdById`, que es lo único que el merge
 * puede garantizar igual en todos lados.
 *
 * Módulo puro (I-1): sin imports de valor en runtime más que `canonical`
 * (JSON determinista, sin estado ni crypto), para que el meta-test del grafo
 * de `mergeLevels.ts` siga en verde.
 */

export const MAX_AUTORIA_DISPUTADA = 8;
export const MAX_LARGO_ID_DISPUTA = 128;

type Registro = Record<string, unknown>;

/** Los campos `'core'` de un gasto, en el mismo orden que `EXPENSE_SLOTS` (recordCore.ts). */
const CAMPOS_NUCLEO_GASTO = [
  'id', 'groupId', 'description', 'amount', 'currency', 'paidById', 'payers',
  'splits', 'splitMode', 'category', 'date', 'note', 'createdAt', 'createdById', 'rev',
] as const;

const ES_CLAVE = /^[0-9a-f]{64}$/i;
const ES_FIRMA = /^[0-9a-f]{128}$/i;

/**
 * Recorta del registro entero el snapshot firmable: sólo lo que decide plata
 * y autoría, más la firma. `null` si no hay firma o no hay autor — sin eso no
 * hay nada verificable que preservar, y una entrada así no puede abrir una
 * disputa atribuible (es exactamente el caso que la ronda 1 dejaba pasar).
 */
function capturarNucleo(r: Registro): NucleoDisputado | null {
  const { k, s, createdById } = r;
  if (typeof k !== 'string' || !k) return null;
  if (typeof s !== 'string' || !s) return null;
  if (typeof createdById !== 'string' || !createdById) return null;

  const nucleo: Registro = {};
  for (const campo of CAMPOS_NUCLEO_GASTO) nucleo[campo] = r[campo];
  return { ...nucleo, k, s } as unknown as NucleoDisputado;
}

/** ¿Tiene forma de núcleo firmado? Sólo forma — nunca se verifica acá (D9). */
function tieneFormaDeNucleo(x: unknown): x is NucleoDisputado {
  if (!x || typeof x !== 'object') return false;
  const r = x as Registro;
  if (typeof r.createdById !== 'string' || r.createdById.length === 0
      || r.createdById.length > MAX_LARGO_ID_DISPUTA) return false;
  if (typeof r.k !== 'string' || !ES_CLAVE.test(r.k)) return false;
  if (typeof r.s !== 'string' || !ES_FIRMA.test(r.s)) return false;
  if (typeof r.rev !== 'number') return false;
  if (typeof r.id !== 'string' || r.id.length === 0) return false;
  return true;
}

/**
 * Filtra lo que no tiene forma de núcleo firmado, deduplica por contenido
 * canónico y aplica el tope determinista de cantidad (G9: sin esto un
 * registro podría crecer sin límite con entradas basura — acotado además, en
 * bytes, por `MAX_REGISTRO_BYTES` al recibir, `lww.ts`/`topes.ts`).
 */
export function normalizarDisputa(entradas: unknown): NucleoDisputado[] {
  if (!Array.isArray(entradas)) return [];
  const limpias = entradas.filter(tieneFormaDeNucleo);

  const porContenido = new Map<string, NucleoDisputado>();
  for (const e of limpias) porContenido.set(canonical(e), e);

  return [...porContenido.values()]
    .sort((a, b) => {
      const ca = canonical(a);
      const cb = canonical(b);
      return ca < cb ? -1 : ca > cb ? 1 : 0;
    })
    .slice(0, MAX_AUTORIA_DISPUTADA);
}

/**
 * Unión monótona de dos versiones de `autoriaDisputada`, más los núcleos
 * completos de `registroLocal`/`registroRemoto` cuando sus `createdById`
 * difieren entre sí.
 *
 * Devuelve la MISMA referencia de `local` cuando el resultado no cambia — el
 * mismo motivo que `unirVotos`/`unirAcuses` en `mergeLevels.ts`: sin esto,
 * cada drenado del relay produce un array nuevo por gasto y dispara un
 * re-render y una escritura a disco cada 20 segundos.
 */
export function unirDisputa(
  local: readonly NucleoDisputado[] | undefined,
  remoto: readonly NucleoDisputado[] | undefined,
  registroLocal: Registro,
  registroRemoto: Registro,
): NucleoDisputado[] | undefined {
  const base: unknown[] = [...(local ?? []), ...(remoto ?? [])];

  const autorLocal = registroLocal.createdById;
  const autorRemoto = registroRemoto.createdById;
  if (
    typeof autorLocal === 'string' && typeof autorRemoto === 'string' && autorLocal !== autorRemoto
  ) {
    const nl = capturarNucleo(registroLocal);
    const nr = capturarNucleo(registroRemoto);
    if (nl) base.push(nl);
    if (nr) base.push(nr);
  }

  const out = normalizarDisputa(base);
  if (out.length === 0) return undefined;
  if (
    local !== undefined && local.length === out.length
    && local.every((v, i) => canonical(v) === canonical(out[i]))
  ) {
    return local as NucleoDisputado[];
  }
  return out;
}
