import { verifyCore, type CoreVerdict } from './recordSign';
import { authorKeysFor } from './authorKeys';
import type { Expense, NucleoDisputado } from '@/src/types/models';

/**
 * **Quién decide si una disputa de autoría es de verdad** (T-170 · D-2,
 * enmienda de disputa firmada — ronda 2).
 *
 * El merge (`mergeLevels.ts`/`autoria.ts`) sólo UNE `autoriaDisputada` por
 * forma y contenido: nunca verifica una firma (D9). Este módulo vive AFUERA
 * de ese grafo a propósito — importa `recordSign` (crypto) y `authorKeys`
 * (estado) — y es el único lugar que decide si un núcleo competidor es
 * atribuible de verdad.
 *
 * **Hay disputa sólo si existen dos o más autores DISTINTOS cuyo núcleo
 * verifica `valida`** contra la clave que ya conocemos de ese autor. Un id
 * inyectado sin firma, o firmado con una clave que no es la del autor que
 * dice ser, no cuenta — es exactamente el agujero que la ronda 1 dejaba
 * abierto (T-170-verifier.md, D-3: «basta inyectar un id sin reescribir el
 * núcleo»).
 *
 * El núcleo VIGENTE del gasto (`e.createdById`/`e.k`/`e.s`) cuenta como uno
 * más: si Mallory re-estampó el núcleo y ganó por `rev` (R4, aceptado por el
 * PO), su firma también verifica, y hace falta contarla para que la disputa
 * se abra contra el autor genuino que quedó en `autoriaDisputada`.
 */

/** Verificador inyectable — por defecto, el veredicto real contra la caché de claves conocidas. */
export type VerificadorDeNucleo = (autorId: string, nucleo: NucleoDisputado) => CoreVerdict;

const verificadorReal: VerificadorDeNucleo = (autorId, nucleo) =>
  verifyCore('expense', nucleo as unknown as Expense, authorKeysFor(autorId, nucleo.k));

/**
 * Memoizado por REFERENCIA del gasto: `mergeRecord` garantiza la misma
 * referencia cuando nada cambió (I-2), así que repetir la pregunta sobre el
 * mismo objeto —un re-render, una segunda pasada de `resolvePendingDeletions`—
 * no vuelve a pagar la curva (~4 ms por firma). Sólo se cachea con el
 * verificador de PRODUCCIÓN: un test que inyecta el suyo no debe heredar el
 * resultado de otro.
 */
const cache = new WeakMap<Expense, readonly string[]>();

function calcular(e: Expense, verificar: VerificadorDeNucleo): string[] {
  const autores = new Set<string>();

  // El núcleo vigente cuenta como uno, si tiene firma y verifica.
  if (typeof e.k === 'string' && e.k && typeof e.s === 'string' && e.s && e.createdById) {
    if (verificar(e.createdById, e as unknown as NucleoDisputado) === 'valida') {
      autores.add(e.createdById);
    }
  }

  for (const entrada of e.autoriaDisputada ?? []) {
    if (!entrada || typeof entrada.createdById !== 'string' || !entrada.createdById) continue;
    if (typeof entrada.k !== 'string' || !entrada.k) continue;
    if (verificar(entrada.createdById, entrada) === 'valida') autores.add(entrada.createdById);
  }

  return [...autores].sort();
}

/**
 * Los autores cuyo núcleo (vigente o competidor) verifica `valida`. Vacío o
 * con un solo autor ⇒ no hay disputa atribuible. Con dos o más, es lo que la
 * UI de T-169 muestra como «quién disputó» (Task 8).
 */
export function autoresVerificados(
  e: Expense,
  verificar: VerificadorDeNucleo = verificadorReal,
): readonly string[] {
  if (verificar === verificadorReal) {
    const cacheado = cache.get(e);
    if (cacheado) return cacheado;
  }

  const out = calcular(e, verificar);
  if (verificar === verificadorReal) cache.set(e, out);
  return out;
}

/**
 * ¿Hay disputa de autoría de verdad? Ningún `forced` inmediato vale mientras
 * esto sea `true` (I-10) — ni siquiera el del autor genuino: es el predicado
 * único que usa `src/sync/forcedTrust.ts` y la UI (`app/expense/[id].tsx`).
 */
export function enDisputa(e: Expense, verificar: VerificadorDeNucleo = verificadorReal): boolean {
  return autoresVerificados(e, verificar).length > 1;
}
