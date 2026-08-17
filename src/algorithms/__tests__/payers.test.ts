import {
  expensePayers, hasMultiplePayers, primaryPayerId, validatePayers, normalizePayers,
} from '../payers';
import type { Expense, Payer } from '@/src/types/models';

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: 'e1', groupId: 'g1', description: 'Cena', amount: 10000, currency: 'ARS',
    paidById: 'ua', splitMode: 'equal',
    splits: [{ userId: 'ua', amount: 5000, isPaid: false }, { userId: 'ub', amount: 5000, isPaid: false }],
    category: 'food', date: 0, createdAt: 0, createdById: 'ua',
    deletionVotes: [], updatedAt: 0, isDeleted: false,
    ...over,
  } as Expense;
}

describe('expensePayers (compatibilidad P2P)', () => {
  // El caso que importa: un peer sin actualizar manda gastos SIN `payers`.
  it('un gasto viejo (sólo paidById) se lee como un pagador con el total', () => {
    expect(expensePayers(expense())).toEqual([{ userId: 'ua', amount: 10000 }]);
  });

  it('un gasto nuevo devuelve su desglose', () => {
    const p: Payer[] = [{ userId: 'ua', amount: 6000 }, { userId: 'ub', amount: 4000 }];
    expect(expensePayers(expense({ payers: p }))).toEqual(p);
  });

  it('un array vacío se trata como ausente, no como "nadie pagó"', () => {
    expect(expensePayers(expense({ payers: [] }))).toEqual([{ userId: 'ua', amount: 10000 }]);
  });

  it('hasMultiplePayers distingue los dos casos', () => {
    expect(hasMultiplePayers(expense())).toBe(false);
    expect(hasMultiplePayers(expense({
      payers: [{ userId: 'ua', amount: 6000 }, { userId: 'ub', amount: 4000 }],
    }))).toBe(true);
  });
});

describe('primaryPayerId', () => {
  it('gana el que más puso', () => {
    expect(primaryPayerId([{ userId: 'ua', amount: 3000 }, { userId: 'ub', amount: 7000 }])).toBe('ub');
  });

  it('ante empate gana el userId menor (determinista entre devices)', () => {
    expect(primaryPayerId([{ userId: 'ub', amount: 5000 }, { userId: 'ua', amount: 5000 }])).toBe('ua');
    expect(primaryPayerId([{ userId: 'ua', amount: 5000 }, { userId: 'ub', amount: 5000 }])).toBe('ua');
  });
});

describe('validatePayers', () => {
  it('acepta un desglose que suma exacto', () => {
    expect(validatePayers([{ userId: 'ua', amount: 6000 }, { userId: 'ub', amount: 4000 }], 10000))
      .toEqual({ ok: true });
  });

  it('rechaza si no suma el total y dice cuánto falta', () => {
    const r = validatePayers([{ userId: 'ua', amount: 6000 }, { userId: 'ub', amount: 3000 }], 10000);
    expect(r).toEqual({ ok: false, reason: 'sum_mismatch', difference: 1000 });
  });

  it('rechaza si se pasa, con diferencia negativa', () => {
    const r = validatePayers([{ userId: 'ua', amount: 11000 }], 10000);
    expect(r).toMatchObject({ ok: false, reason: 'sum_mismatch', difference: -1000 });
  });

  it('rechaza montos negativos o no enteros', () => {
    expect(validatePayers([{ userId: 'ua', amount: -1 }], -1)).toMatchObject({ reason: 'negative' });
    expect(validatePayers([{ userId: 'ua', amount: 10.5 }], 10.5)).toMatchObject({ reason: 'negative' });
  });

  it('rechaza al mismo pagador dos veces', () => {
    expect(validatePayers([{ userId: 'ua', amount: 5000 }, { userId: 'ua', amount: 5000 }], 10000))
      .toMatchObject({ reason: 'duplicate' });
  });

  it('rechaza una lista vacía', () => {
    expect(validatePayers([], 10000)).toMatchObject({ reason: 'empty' });
  });
});

describe('normalizePayers', () => {
  it('con un solo pagador NO guarda el campo payers', () => {
    expect(normalizePayers([{ userId: 'ua', amount: 10000 }]))
      .toEqual({ paidById: 'ua' });
  });

  it('descarta a los que pusieron 0', () => {
    expect(normalizePayers([{ userId: 'ua', amount: 10000 }, { userId: 'ub', amount: 0 }]))
      .toEqual({ paidById: 'ua' });
  });

  it('con varios, guarda el desglose y el principal es el que más puso', () => {
    expect(normalizePayers([{ userId: 'ua', amount: 4000 }, { userId: 'ub', amount: 6000 }]))
      .toEqual({
        paidById: 'ub',
        payers: [{ userId: 'ua', amount: 4000 }, { userId: 'ub', amount: 6000 }],
      });
  });
});

describe('normalizePayers — pasar de varios pagadores a uno solo', () => {
  // Nació como bug real: la clave `payers` se omitía al quedar un solo pagador,
  // y como al editar se aplica con spread, el desglose VIEJO sobrevivía. El
  // gasto decía "pagó uno" pero calculateBalances seguía usando el array
  // anterior, y el error se persistía y viajaba por sync.
  it('devuelve la clave payers en undefined, no ausente', () => {
    const out = normalizePayers([{ userId: 'ua', amount: 10000 }]);
    expect('payers' in out).toBe(true);
    expect(out.payers).toBeUndefined();
  });

  it('aplicado con spread, LIMPIA el desglose anterior', () => {
    const anterior = {
      paidById: 'ub',
      payers: [{ userId: 'ua', amount: 4000 }, { userId: 'ub', amount: 6000 }],
    };
    const actualizado = { ...anterior, ...normalizePayers([{ userId: 'ua', amount: 10000 }]) };

    expect(actualizado.payers).toBeUndefined();
    expect(actualizado.paidById).toBe('ua');
  });
});
