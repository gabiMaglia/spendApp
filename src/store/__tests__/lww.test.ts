import { mergeByIdLWW, incomingWins } from '../lww';
import { TOLERANCIA_RELOJ_MS } from '@/src/store/relojDelMerge';

const NOW = 1_700_000_000_000;

const rec = (id: string, updatedAt: number, extra: Record<string, unknown> = {}) =>
  ({ id, updatedAt, ...extra });

describe('incomingWins', () => {
  it('gana el updatedAt mayor', () => {
    expect(incomingWins(rec('a', 20), rec('a', 10))).toBe(true);
    expect(incomingWins(rec('a', 10), rec('a', 20))).toBe(false);
  });

  describe('empate de updatedAt (el bug de divergencia permanente)', () => {
    // Con "gana el local" ante empate, dos devices que editan el mismo registro
    // en el mismo milisegundo se quedan cada uno con SU versión para siempre:
    // un sync posterior no lo arregla porque los timestamps siguen iguales.
    it('elige un ganador, no se queda con el local por defecto', () => {
      const a = rec('x', 100, { text: 'aaa' });
      const b = rec('x', 100, { text: 'zzz' });

      // Exactamente uno de los dos sentidos gana.
      expect(incomingWins(b, a) !== incomingWins(a, b)).toBe(true);
    });

    it('LOS DOS DEVICES convergen: el resultado no depende de quién mergea', () => {
      const mio  = rec('x', 100, { text: 'aaa' });
      const suyo = rec('x', 100, { text: 'zzz' });

      // Device 1 tiene "mio" y recibe "suyo"; device 2 al revés.
      const enDevice1 = mergeByIdLWW([mio], [suyo], NOW)[0];
      const enDevice2 = mergeByIdLWW([suyo], [mio], NOW)[0];

      expect(enDevice1).toEqual(enDevice2);
    });

    it('el desempate ignora el orden de las claves del objeto', () => {
      const a = { id: 'x', updatedAt: 1, name: 'Ana', amount: 10 };
      const b = { id: 'x', updatedAt: 1, amount: 10, name: 'Ana' };

      // Mismo contenido escrito en otro orden ⇒ ninguno gana (son iguales).
      expect(incomingWins(a, b)).toBe(false);
      expect(incomingWins(b, a)).toBe(false);
    });

    it('registros idénticos: no hay cambio', () => {
      const a = rec('x', 100, { text: 'igual' });
      expect(incomingWins({ ...a }, a)).toBe(false);
    });
  });
});

describe('mergeByIdLWW', () => {
  it('agrega los que no estaban', () => {
    expect(mergeByIdLWW([rec('a', 1)], [rec('b', 1)], NOW).map(r => r.id).sort())
      .toEqual(['a', 'b']);
  });

  it('reemplaza sólo si el entrante gana', () => {
    const out = mergeByIdLWW([rec('a', 10, { v: 'viejo' })], [rec('a', 20, { v: 'nuevo' })], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ v: 'nuevo' });
  });

  it('no pisa con una versión más vieja', () => {
    const out = mergeByIdLWW([rec('a', 20, { v: 'nuevo' })], [rec('a', 10, { v: 'viejo' })], NOW);
    expect(out[0]).toMatchObject({ v: 'nuevo' });
  });

  it('mergear lo mismo dos veces no duplica', () => {
    const inc = [rec('a', 1)];
    const once = mergeByIdLWW([], inc, NOW);
    expect(mergeByIdLWW(once, inc, NOW)).toHaveLength(1);
  });

  it('no muta las listas que recibe', () => {
    const base = [rec('a', 1)];
    mergeByIdLWW(base, [rec('b', 1)], NOW);
    expect(base).toHaveLength(1);
  });

  it('propaga tombstones que llegan más nuevos', () => {
    const out = mergeByIdLWW(
      [rec('a', 1, { isDeleted: false })],
      [rec('a', 2, { isDeleted: true })],
      NOW,
    );
    expect(out[0]).toMatchObject({ isDeleted: true });
  });

  it('un lote entrante vacío deja todo como estaba', () => {
    expect(mergeByIdLWW([rec('a', 1)], [], NOW)).toHaveLength(1);
  });

  /**
   * T-171 — el mismo tope de reloj de `relojDelMerge.ts` que ya tenía
   * `mergeUsersLWW` (T-137), ahora en la función genérica que usa
   * `personalStore` vía `mergePersonalPure`. Sin esto, un `updatedAt: 9e15`
   * ganaba el desempate para siempre: ninguna edición honesta futura podía
   * superarlo numéricamente.
   */
  describe('tope de reloj (T-171)', () => {
    it('un entrante con updatedAt del futuro no gana contra un local plausible', () => {
      const out = mergeByIdLWW([rec('a', 1_000, { v: 'local' })], [rec('a', 9e15, { v: 'atacante' })], NOW);
      expect(out[0]).toMatchObject({ v: 'local' });
    });

    it('un id NUEVO con updatedAt del futuro no se agrega', () => {
      const out = mergeByIdLWW([], [rec('a', 9e15)], NOW);
      expect(out.find(r => r.id === 'a')).toBeUndefined();
    });

    it('un local ya envenenado en el futuro pierde contra cualquier entrante plausible, aunque su updatedAt sea MENOR', () => {
      const out = mergeByIdLWW([rec('a', 9e15, { v: 'vandalizado' })], [rec('a', 500, { v: 'real' })], NOW);
      expect(out[0]).toMatchObject({ v: 'real' });
    });

    it.each([
      ['string no numérico', 'zzz'],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['null', null],
    ])('un updatedAt %s cuenta como envenenado: el entrante no gana', (_d, raw) => {
      const out = mergeByIdLWW([rec('a', 1_000, { v: 'local' })], [rec('a', raw as number, { v: 'basura' })], NOW);
      expect(out[0]).toMatchObject({ v: 'local' });
    });

    it('justo en el borde de la tolerancia: now + TOLERANCIA no es futuro, gana', () => {
      const enElBorde = NOW + TOLERANCIA_RELOJ_MS;
      const out = mergeByIdLWW([rec('a', 1_000, { v: 'local' })], [rec('a', enElBorde, { v: 'nuevo' })], NOW);
      expect(out[0]).toMatchObject({ v: 'nuevo' });
    });

    it('un tick pasado el borde de la tolerancia SÍ es futuro, no gana', () => {
      const pasadoElBorde = NOW + TOLERANCIA_RELOJ_MS + 1;
      const out = mergeByIdLWW([rec('a', 1_000, { v: 'local' })], [rec('a', pasadoElBorde, { v: 'nuevo' })], NOW);
      expect(out[0]).toMatchObject({ v: 'local' });
    });

    it('convergencia: dos aparatos con órdenes de llegada distintos terminan iguales, con el ataque de por medio', () => {
      const legit = rec('a', NOW + 1_000, { v: 'real' });
      const ataque = rec('a', 9e15, { v: 'atacante' });
      const base = [rec('a', 500, { v: 'inicial' })];

      const device1 = mergeByIdLWW(mergeByIdLWW(base, [ataque], NOW), [legit], NOW + 2_000);
      const device2 = mergeByIdLWW(mergeByIdLWW(base, [legit], NOW + 2_000), [ataque], NOW + 2_000);

      expect(device1).toEqual(device2);
      expect(device1[0]).toMatchObject({ v: 'real' });
    });
  });

  /**
   * PO 2026-09-26 (T-171, ronda de fix 1): «agregar, pero no pisar» — SOLO
   * para `personal` (`mergePersonalPure` la activa). El riesgo ahí es un
   * reloj propio adelantado, no un atacante externo, y perder un movimiento
   * propio es peor que dejarlo envenenado un rato. `users` NO usa esta
   * opción: sigue el criterio de T-137 sin cambios (ver mergeUsersLWW.test.ts,
   * que no toca `now`/opts y corre con el default).
   */
  describe('opción agregarNuevosEnvenenados (T-171 fix 1)', () => {
    it('sin la opción (default), un id NUEVO envenenado NO se agrega — comportamiento de users intacto', () => {
      const out = mergeByIdLWW([], [rec('a', 9e15)], NOW);
      expect(out).toHaveLength(0);
    });

    it('con la opción activa, un id NUEVO envenenado SÍ se agrega', () => {
      const out = mergeByIdLWW([], [rec('a', 9e15, { v: 'adelantado' })], NOW, { agregarNuevosEnvenenados: true });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ v: 'adelantado' });
    });

    it('con la opción activa, un entrante envenenado cuyo id YA EXISTE no pisa al local', () => {
      const out = mergeByIdLWW(
        [rec('a', 1_000, { v: 'local' })],
        [rec('a', 9e15, { v: 'atacante' })],
        NOW,
        { agregarNuevosEnvenenados: true },
      );
      expect(out[0]).toMatchObject({ v: 'local' });
    });

    it('con la opción activa, un local envenenado sigue autocurándose contra un entrante plausible', () => {
      const out = mergeByIdLWW(
        [rec('a', 9e15, { v: 'vandalizado' })],
        [rec('a', 500, { v: 'real' })],
        NOW,
        { agregarNuevosEnvenenados: true },
      );
      expect(out[0]).toMatchObject({ v: 'real' });
    });
  });
});
