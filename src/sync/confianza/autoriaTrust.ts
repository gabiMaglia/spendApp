import { verifyCore, type CoreVerdict } from './recordSign';
import { conPropiaSoloParaValida } from './authorKeys';
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

// T-170 · D-2: la propia sólo puede MEJORAR este veredicto hacia `valida`
// (residual de la ronda de retorno 2, `authorKeys.ts`, `conPropiaSoloParaValida`).
const verificadorReal: VerificadorDeNucleo = (autorId, nucleo) =>
  conPropiaSoloParaValida(
    autorId, nucleo.k,
    keys => verifyCore('expense', nucleo as unknown as Expense, keys),
    v => v === 'valida',
  );

/**
 * Memoizado por REFERENCIA del gasto: `mergeRecord` garantiza la misma
 * referencia cuando nada cambió (I-2), así que repetir la pregunta sobre el
 * mismo objeto —un re-render, una segunda pasada del arranque— no vuelve a
 * pagar la curva (~4 ms por firma). Sólo se cachea con el
 * verificador de PRODUCCIÓN: un test que inyecta el suyo no debe heredar el
 * resultado de otro.
 */
const cache = new WeakMap<Expense, readonly string[]>();

function calcular(e: Expense, verificar: VerificadorDeNucleo): string[] {
  const autores = new Set<string>();

  // El núcleo vigente cuenta como uno, si tiene firma y verifica — contra el
  // firmante EFECTIVO (T-185): `editedById` si alguien reeditó, si no
  // `createdById`. Es quien firmó de verdad; verificar contra `createdById`
  // a secas haría fallar toda edición ajena legítima de un grupo `open`.
  const firmanteEfectivo = e.editedById ?? e.createdById;
  if (typeof e.k === 'string' && e.k && typeof e.s === 'string' && e.s && firmanteEfectivo) {
    if (verificar(firmanteEfectivo, e as unknown as NucleoDisputado) === 'valida') {
      autores.add(firmanteEfectivo);
    }
  }

  for (const entrada of e.autoriaDisputada ?? []) {
    if (!entrada || typeof entrada.createdById !== 'string' || !entrada.createdById) continue;
    if (typeof entrada.k !== 'string' || !entrada.k) continue;
    // T-170 · D-3, ronda de retorno 2 (PoC P3c del verificador): la firma
    // cubre el núcleo ENTERO, id y groupId incluidos — cierra igual de bien
    // para el gasto que la trajo que para CUALQUIER OTRO gasto real de ese
    // mismo autor. Sin este chequeo, un miembro cualquiera puede pegar acá
    // un núcleo legítimo y legítimamente firmado de OTRO gasto (uno que
    // tiene a mano en su propio estado local) y hacer que esa firma real
    // cuente como si fuera del gasto que la aloja. La entrada sólo puede
    // disputar EL GASTO CUYA COPIA ES: mismo `id` y mismo `groupId`.
    if (entrada.id !== e.id || entrada.groupId !== e.groupId) continue;
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
 * ¿Hay disputa de autoría de verdad? Usada por el banner de disputa en la UI
 * (`app/expense/[id].tsx`) — T-186 sacó el `forced` del creador junto con el
 * modo «con acuerdo», así que esta ya no gatea ningún borrado.
 */
export function enDisputa(e: Expense, verificar: VerificadorDeNucleo = verificadorReal): boolean {
  return autoresVerificados(e, verificar).length > 1;
}
