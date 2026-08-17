import { mergeByIdLWW, incomingWins } from '../lww';

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
      const enDevice1 = mergeByIdLWW([mio], [suyo])[0];
      const enDevice2 = mergeByIdLWW([suyo], [mio])[0];

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
    expect(mergeByIdLWW([rec('a', 1)], [rec('b', 1)]).map(r => r.id).sort())
      .toEqual(['a', 'b']);
  });

  it('reemplaza sólo si el entrante gana', () => {
    const out = mergeByIdLWW([rec('a', 10, { v: 'viejo' })], [rec('a', 20, { v: 'nuevo' })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ v: 'nuevo' });
  });

  it('no pisa con una versión más vieja', () => {
    const out = mergeByIdLWW([rec('a', 20, { v: 'nuevo' })], [rec('a', 10, { v: 'viejo' })]);
    expect(out[0]).toMatchObject({ v: 'nuevo' });
  });

  it('mergear lo mismo dos veces no duplica', () => {
    const inc = [rec('a', 1)];
    const once = mergeByIdLWW([], inc);
    expect(mergeByIdLWW(once, inc)).toHaveLength(1);
  });

  it('no muta las listas que recibe', () => {
    const base = [rec('a', 1)];
    mergeByIdLWW(base, [rec('b', 1)]);
    expect(base).toHaveLength(1);
  });

  it('propaga tombstones que llegan más nuevos', () => {
    const out = mergeByIdLWW(
      [rec('a', 1, { isDeleted: false })],
      [rec('a', 2, { isDeleted: true })],
    );
    expect(out[0]).toMatchObject({ isDeleted: true });
  });

  it('un lote entrante vacío deja todo como estaba', () => {
    expect(mergeByIdLWW([rec('a', 1)], [])).toHaveLength(1);
  });
});
