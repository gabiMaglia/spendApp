import { frenaLaRonda, rondaDe } from '@/src/sync/voteCore';
import type { RecordVerdict } from '@/src/sync/recordHealth';
import type { DeletionRound } from './deletionRound';
import type { DeletionVote } from '@/src/types/models';

/**
 * **Qué marca le corresponde a un veredicto** (T-041 · S10).
 *
 * Pura, sin React y sin i18n: es la única regla de la marca y vive sola para
 * que se pueda romper de a una en el meta-test de mutación. La UI dibuja lo que
 * dice esta función; no decide nada por su cuenta.
 *
 * **La decisión que gobierna el archivo entero: una sola marca** (PO,
 * 2026-08-31). Para el usuario, «no se pudo verificar quién cargó esto» y «la
 * firma no cierra» se actúan igual —mirar el gasto—, así que dos marcas
 * distintas informarían un matiz sobre el que no se puede hacer nada distinto y
 * asustarían el doble. **La medición interna los separa SIEMPRE y eso no se
 * negocia**: `recordHealth.ts` sigue contando los cuatro veredictos por
 * separado, porque es el único número que gobierna si la fase de rechazo se
 * enciende alguna vez.
 *
 * **Y `valida` no lleva marca.** Si todo lleva marca, la marca no dice nada.
 *
 * **El techo de lo que la marca puede prometer** (D3): `valida` significa que
 * el registro lo firmó un dispositivo cuya clave nos llegó **por el canal de
 * contactos** — y `savePeerFromCard` puede sembrar esa primera clave desde una
 * tarjeta que llegó por el relay, no sólo desde un QR presencial. Ausencia de
 * marca NO es «esta persona estuvo delante nuestro», y el copy neutro que
 * eligió el PO es el único compatible con eso.
 */

/** Lo que la fila sabe de sí misma. `pendiente` no es una acusación ni un aval. */
export type TrustState = 'pendiente' | 'verificado' | 'marcado';

/**
 * El estado de una fila a partir de su veredicto.
 *
 * `undefined` = todavía no se verificó, y es un estado normal y frecuente: por
 * D8 se verifica **sólo lo que el usuario está mirando**, así que hay una
 * ventana entre que la fila aparece y que la cola llega a ella. Durante esa
 * ventana no se afirma nada — ni marca (acusaría por no haber mirado todavía,
 * que es el error que D2 cerró en la medición) ni visto bueno.
 */
export function trustOf(verdict: RecordVerdict | undefined): TrustState {
  if (verdict === undefined) return 'pendiente';
  if (verdict === 'valida') return 'verificado';

  /**
   * Las otras tres llevan la misma marca:
   *
   *  - `no_verificable` — falta de información. Es el caso masivo y va a serlo
   *    para siempre: por R2 (opción A) el histórico no se re-firma nunca.
   *  - `invalida` — hay firma y no cierra. Es la señal.
   *  - `no_firmable` — nadie puede firmarlo por diseño (D4): los pagos de
   *    absorción de `applyLeave` y los gastos materializados de una plantilla.
   *    Llevan marca porque el copy es LITERALMENTE cierto para ellos; no
   *    marcarlos afirmaría en silencio una verificación que nadie hizo. Cuando
   *    S9 los ate a su origen firmado, dejarán de estar marcados solos.
   */
  return 'marcado';
}

/** ¿Esta fila muestra la marca? */
export function isMarked(state: TrustState): boolean {
  return state === 'marcado';
}

/**
 * El voto al que le corresponde la marca de una ronda de borrado.
 *
 * La banda de la ronda —en el detalle del gasto y en el feed— atribuye a UNA
 * persona: «Ana pidió borrar», «Beto restauró». Lo que hay que verificar ahí no
 * es el núcleo del gasto sino **la firma del enunciado que se está
 * atribuyendo**, que es una cosa distinta y la firma otra persona.
 *
 * Devuelve `undefined` cuando no se puede señalar un voto: sin ronda, o cuando
 * el que la ronda nombra no tiene un enunciado de ESTA ronda. La marca que
 * corresponde entonces la decide `trustOf(undefined)` — `pendiente`, ni acusa ni
 * avala.
 *
 * **El `forced` del creador se honra siempre** (R3, decisión del PO), verifique
 * o no. Lo único que agrega esto es la atribución: quién lo hizo y si su firma
 * cerró.
 */
export function attributedVote(
  round: DeletionRound | null, votes: readonly DeletionVote[],
): DeletionVote | undefined {
  if (round === null) return undefined;

  const persona = round.status === 'open' ? round.requestedBy : round.stoppedBy;
  if (!persona) return undefined;

  /**
   * Un voto de otra ronda del mismo autor no puede prestarle su firma a ésta:
   * un enunciado viejo y válido haría pasar por verificada una atribución que
   * nunca se firmó. La ronda sintética `''` —lo anterior a S8 y lo de un peer
   * sin actualizar— sí entra: el otro lado no tenía cómo nombrar la ronda.
   */
  const deLaRonda = votes.filter(v =>
    v.userId === persona &&
    (rondaDe(v) === round.roundId || rondaDe(v) === '') &&
    (round.status === 'open' ? !frenaLaRonda(v) : frenaLaRonda(v)),
  );

  // El más nuevo: es el enunciado vigente de esa persona en esta ronda.
  return deLaRonda.reduce<DeletionVote | undefined>(
    (mejor, v) => (mejor === undefined || v.votedAt > mejor.votedAt ? v : mejor),
    undefined,
  );
}
