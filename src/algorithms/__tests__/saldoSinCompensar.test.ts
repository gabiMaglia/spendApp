import {
  acreedoresSinCompensar, pagosParaSaldarConAmigo, totalesPorMoneda,
} from '@/src/algorithms/saldoSinCompensar';
import { deudasDelGrupo } from '@/src/algorithms/deudasDelGrupo';
import type { CurrencyCode } from '@/src/constants/currencies';
import type { Expense, Group, Payment } from '@/src/types/models';

/**
 * T-225 (PO 2026-09-29): saldar contra lo que YO le debo a esa persona, sin
 * compensar con lo que ella me debe. Toca plata: enteros en menor unidad.
 */

let n = 0;
function gasto(
  groupId: string, paidById: string, partes: Record<string, number>, currency: CurrencyCode = 'ARS',
  extra: Partial<Expense> = {},
): Expense {
  n++;
  const amount = Object.values(partes).reduce((s, x) => s + x, 0);
  return {
    id: `e${n}`, groupId, description: 'x', amount, currency, paidById, splitMode: 'custom',
    category: 'other', date: n, createdAt: n, createdById: paidById,
    splits: Object.entries(partes).map(([userId, a]) => ({ userId, amount: a, isPaid: false })),
    updatedAt: n, isDeleted: false, ...extra,
  } as unknown as Expense;
}
function pago(groupId: string, from: string, to: string, amount: number, currency: CurrencyCode = 'ARS'): Payment {
  n++;
  return {
    id: `p${n}`, groupId, fromUserId: from, toUserId: to, amount, currency,
    date: n, createdAt: n, createdById: from, updatedAt: n, isDeleted: false,
  } as unknown as Payment;
}
function grupo(id: string, memberIds: string[], extra: Partial<Group> = {}): Group {
  return {
    id, name: `Grupo ${id}`, memberIds, currency: 'ARS', miembros: {},
    createdAt: 0, createdById: memberIds[0], updatedAt: 0, isDeleted: false, ...extra,
  } as unknown as Group;
}

describe('acreedoresSinCompensar — modo «todo» dentro de un grupo', () => {
  it('caso del PO: debo 60 a Ana aunque Ana me deba 200 → Ana es acreedora por 60', () => {
    const d = deudasDelGrupo([
      gasto('g1', 'yo', { yo: 100, ana: 200 }),
      gasto('g1', 'ana', { yo: 60, ana: 60 }),
    ], [], ['yo', 'ana']);
    expect(acreedoresSinCompensar(d, 'yo', 'ARS')).toEqual([{ userId: 'ana', amount: 60 }]);
    expect(acreedoresSinCompensar(d, 'ana', 'ARS')).toEqual([{ userId: 'yo', amount: 200 }]);
  });

  it('dos acreedores, cada uno por lo que le debo, de mayor a menor', () => {
    // Mi neto es positivo (me deben 1500, debo 500+300): con el neto no había acreedores.
    const d = deudasDelGrupo([
      gasto('g1', 'ana', { yo: 300, ana: 300 }),
      gasto('g1', 'beto', { yo: 500, beto: 500 }),
      gasto('g1', 'yo', { yo: 1500, ana: 1500 }),
    ], [], ['yo', 'ana', 'beto']);
    expect(acreedoresSinCompensar(d, 'yo', 'ARS')).toEqual([
      { userId: 'beto', amount: 500 },
      { userId: 'ana', amount: 300 },
    ]);
  });

  it('sólo la moneda pedida', () => {
    const d = deudasDelGrupo([
      gasto('g1', 'ana', { yo: 300, ana: 300 }, 'USD'),
    ], [], ['yo', 'ana']);
    expect(acreedoresSinCompensar(d, 'yo', 'ARS')).toEqual([]);
    expect(acreedoresSinCompensar(d, 'yo', 'USD')).toEqual([{ userId: 'ana', amount: 300 }]);
  });

  it('sin deudas, nadie', () => {
    expect(acreedoresSinCompensar([], 'yo', 'ARS')).toEqual([]);
  });
});

describe('pagosParaSaldarConAmigo — saldar desde Amigos', () => {
  const base = {
    groups: [grupo('g1', ['yo', 'ana']), grupo('g2', ['yo', 'ana', 'beto'])],
    expenses: [
      gasto('g1', 'ana', { yo: 6000, ana: 6000 }),      // debo 6000 en g1
      gasto('g1', 'yo', { yo: 20000, ana: 20000 }),     // Ana me debe 20000 en g1
      gasto('g2', 'ana', { yo: 3000, ana: 3000 }),      // debo 3000 en g2
    ],
    payments: [] as Payment[],
    archivedIds: [] as string[],
    yo: 'yo', amigo: 'ana',
  };

  it('un pago por grupo compartido, por lo que le debo ahí (sin compensar)', () => {
    const pagos = pagosParaSaldarConAmigo(base);
    expect(pagos).toEqual([
      { groupId: 'g1', groupName: 'Grupo g1', toUserId: 'ana', currency: 'ARS', amount: 6000 },
      { groupId: 'g2', groupName: 'Grupo g2', toUserId: 'ana', currency: 'ARS', amount: 3000 },
    ]);
    expect(totalesPorMoneda(pagos)).toEqual([{ currency: 'ARS', amount: 9000 }]);
  });

  it('un grupo donde no le debo nada (sólo me debe ella) no genera pago', () => {
    const pagos = pagosParaSaldarConAmigo({
      ...base,
      groups: [...base.groups, grupo('g3', ['yo', 'ana'])],
      expenses: [...base.expenses, gasto('g3', 'yo', { yo: 100, ana: 100 })],
    });
    expect(pagos.map(p => p.groupId)).toEqual(['g1', 'g2']);
  });

  it('lo ya pagado se descuenta', () => {
    const pagos = pagosParaSaldarConAmigo({ ...base, payments: [pago('g1', 'yo', 'ana', 2000)] });
    expect(pagos.find(p => p.groupId === 'g1')?.amount).toBe(4000);
  });

  it('grupos archivados o borrados no cuentan', () => {
    const pagos = pagosParaSaldarConAmigo({
      ...base,
      groups: [grupo('g1', ['yo', 'ana'], { isDeleted: true }), base.groups[1]],
      archivedIds: ['g2'],
    });
    expect(pagos).toEqual([]);
  });

  it('un grupo del que no soy parte no cuenta', () => {
    const pagos = pagosParaSaldarConAmigo({
      ...base,
      groups: [...base.groups, grupo('g4', ['ana', 'beto'])],
      expenses: [...base.expenses, gasto('g4', 'ana', { beto: 50, ana: 50 })],
    });
    expect(pagos.map(p => p.groupId)).toEqual(['g1', 'g2']);
  });

  it('cada pago en su moneda, sin convertir; los totales separados por moneda', () => {
    const pagos = pagosParaSaldarConAmigo({
      ...base,
      groups: [base.groups[0], grupo('g2', ['yo', 'ana'], { currency: 'USD' })],
      expenses: [base.expenses[0], gasto('g2', 'ana', { yo: 25, ana: 25 }, 'USD')],
    });
    expect(pagos).toEqual([
      { groupId: 'g1', groupName: 'Grupo g1', toUserId: 'ana', currency: 'ARS', amount: 6000 },
      { groupId: 'g2', groupName: 'Grupo g2', toUserId: 'ana', currency: 'USD', amount: 25 },
    ]);
    expect(totalesPorMoneda(pagos)).toEqual([
      { currency: 'ARS', amount: 6000 },
      { currency: 'USD', amount: 25 },
    ]);
  });

  it('si no le debo nada en ningún grupo, no hay pagos', () => {
    const pagos = pagosParaSaldarConAmigo({ ...base, expenses: [base.expenses[1]] });
    expect(pagos).toEqual([]);
    expect(totalesPorMoneda(pagos)).toEqual([]);
  });
});
