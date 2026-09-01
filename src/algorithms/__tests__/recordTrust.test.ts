import { trustOf, isMarked, attributedVote, type TrustState } from '../recordTrust';
import type { DeletionRound } from '../deletionRound';
import type { DeletionVote } from '@/src/types/models';
import { recordStats, type RecordVerdict } from '@/src/sync/recordHealth';

/**
 * **Qué marca le corresponde a un veredicto** (T-041 · S10).
 *
 * Es la única regla de la marca y vive acá, pura, para que se pueda romper de a
 * una en el meta-test de mutación. La UI no decide nada: dibuja lo que dice
 * esta función.
 *
 * Las dos decisiones del PO que gobiernan el archivo entero:
 *
 *  - **Una sola marca** (decisión 2 del 2026-08-31). Para el usuario, «no se
 *    pudo verificar» y «la firma no cierra» se actúan igual: mirar el gasto. La
 *    medición interna los separa siempre y eso NO se toca — `recordHealth.ts`
 *    sigue contando los cuatro por separado.
 *  - **`valida` no lleva marca.** Si todo lleva marca, la marca no dice nada.
 */
describe('trustOf', () => {
  it('`valida` es lo único que NO lleva marca', () => {
    expect(trustOf('valida')).toBe<TrustState>('verificado');
    expect(isMarked(trustOf('valida'))).toBe(false);
  });

  /**
   * Las dos causas de R1, con la misma marca. Se prueban por separado a
   * propósito: un `trustOf` que sólo mirara una de las dos pasaría un test que
   * las mezclara en un solo caso.
   */
  it('`no_verificable` lleva marca', () => {
    expect(trustOf('no_verificable')).toBe<TrustState>('marcado');
    expect(isMarked(trustOf('no_verificable'))).toBe(true);
  });

  it('`invalida` lleva marca', () => {
    expect(trustOf('invalida')).toBe<TrustState>('marcado');
    expect(isMarked(trustOf('invalida'))).toBe(true);
  });

  /**
   * El cuarto veredicto de D4: los que nadie puede firmar por diseño (los pagos
   * de absorción de `applyLeave`, los gastos materializados de una plantilla).
   * También llevan marca, y el motivo es que el copy es LITERALMENTE cierto para
   * ellos: no se pudo verificar quién los cargó. No marcarlos sería afirmar en
   * silencio una verificación que nadie hizo — lo contrario del principio del PO
   * («prevenir no es la defensa; ver y poder deshacer, sí»).
   */
  it('`no_firmable` lleva marca', () => {
    expect(trustOf('no_firmable')).toBe<TrustState>('marcado');
    expect(isMarked(trustOf('no_firmable'))).toBe(true);
  });

  /**
   * Todavía no se verificó. **No es lo mismo que verificado** y no puede
   * dibujarse igual que `marcado`: acusar por no haber mirado todavía es el
   * error que D2 cerró en la medición, y acá sería el mismo error en pantalla.
   *
   * Que exista este estado es consecuencia directa de D8: se verifica sólo lo
   * que el usuario está mirando, así que hay una ventana —de un tick, o de lo
   * que tarde la cola— en la que no sabemos nada.
   */
  it('sin veredicto todavía: ni verificado ni marcado', () => {
    expect(trustOf(undefined)).toBe<TrustState>('pendiente');
    expect(isMarked(trustOf(undefined))).toBe(false);
  });

  /**
   * Guard de enumeración: si mañana aparece un quinto veredicto y nadie lo
   * clasifica acá, esto falla en vez de caer en silencio en la rama de la marca
   * (o, peor, en la de «verificado»). Es el mismo patrón que ya usan
   * `relayScope.test.ts` y el guard de campos de `recordCore`.
   */
  it('los veredictos de la medición están TODOS clasificados', () => {
    // Enumerados desde la medición misma, no desde una lista escrita a mano:
    // `recordStats()` devuelve un contador por veredicto, así que un quinto
    // veredicto entra solo. Con una lista a mano, agregarlo y olvidarse de
    // clasificarlo dejaría la suite en verde.
    const todos = Object.keys(recordStats()) as RecordVerdict[];
    expect(todos.length).toBeGreaterThanOrEqual(4);   // el recorrido enumeró de verdad
    expect(todos.filter(v => trustOf(v) === 'pendiente')).toEqual([]);
  });
});

/**
 * **A qué voto le corresponde la marca de una ronda de borrado.**
 *
 * La banda de la ronda —en el detalle y en el feed— atribuye a UNA persona:
 * «Ana pidió borrar», «Beto restauró». Marcar esa banda con el veredicto del
 * gasto sería marcar otra cosa; lo que hay que verificar es la firma del
 * enunciado que se está atribuyendo. Es el llamador que le faltaba a
 * `verifyVote` desde S8.
 */
describe('attributedVote', () => {
  const pedido = (over: Partial<DeletionVote> = {}): DeletionVote => ({
    userId: 'ana', votedAt: 100, action: 'delete', roundId: 'r1', ...over,
  });
  const objecion = (over: Partial<DeletionVote> = {}): DeletionVote => ({
    userId: 'beto', votedAt: 200, action: 'cancel', roundId: 'r1', ...over,
  });

  const ronda = (over: Partial<DeletionRound> = {}): DeletionRound => ({
    roundId: 'r1', requestedBy: 'ana', requestedAt: 100,
    expiresAt: 100 + 72 * 3600_000, status: 'open', ...over,
  });

  it('una ronda abierta atribuye al pedido que la abrió', () => {
    const votos = [pedido(), objecion({ roundId: 'otra' })];
    expect(attributedVote(ronda(), votos)).toBe(votos[0]);
  });

  it('una ronda frenada atribuye al voto que la frenó, no al pedido', () => {
    const votos = [pedido(), objecion()];
    expect(attributedVote(ronda({ status: 'objected', stoppedBy: 'beto' }), votos))
      .toBe(votos[1]);
  });

  it('una ronda restaurada atribuye al `restore`', () => {
    const restore = objecion({ userId: 'caro', votedAt: 300, intent: 'restore' });
    const votos = [pedido(), restore];
    expect(attributedVote(ronda({ status: 'restored', stoppedBy: 'caro' }), votos))
      .toBe(restore);
  });

  /**
   * Un voto de OTRA ronda del mismo autor no puede prestarle su firma a ésta.
   * Sin este corte, un enunciado viejo y válido haría pasar por verificada una
   * atribución que nunca se firmó.
   */
  it('no toma un voto de otra ronda', () => {
    const votos = [pedido({ roundId: 'vieja', votedAt: 50 })];
    expect(attributedVote(ronda(), votos)).toBeUndefined();
  });

  /**
   * La ronda sintética `''` —todo lo anterior a S8 y lo de un peer sin
   * actualizar— entra igual: el otro lado no tenía cómo nombrar la ronda, y
   * perder su atribución sería dejar de mostrar quién pidió el borrado.
   */
  it('acepta el voto sin ronda, que es el de antes de S8', () => {
    const viejo = { userId: 'ana', votedAt: 100, action: 'delete' as const };
    expect(attributedVote(ronda(), [viejo])).toBe(viejo);
  });

  it('sin ronda no hay nada que atribuir', () => {
    expect(attributedVote(null, [pedido()])).toBeUndefined();
  });
});
