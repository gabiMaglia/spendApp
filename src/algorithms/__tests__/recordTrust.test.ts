import { trustOf, isMarked, type TrustState } from '../recordTrust';
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
