import {
  armarTimeline, cuentasPorPersona, deudasDeGrupo,
} from '@/src/screens/groupDetail/detalleDeGrupo';
import type { Expense, Group, Payment } from '@/src/types/models';

/**
 * T-223: lógica pura que vivía dentro de `app/groups/[id].tsx` (760 líneas).
 * Estos tests fijan el comportamiento de antes de la mudanza.
 */

const grupo = (memberIds = ['ana', 'beto']): Group => ({
  id: 'g1', name: 'Asado', memberIds, currency: 'ARS',
  miembros: Object.fromEntries(memberIds.map((uid, i) => [uid, { estado: 'in' as const, at: i }])),
  createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false,
} as Group);

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 1000, currency: 'ARS',
  paidById: 'ana', splitMode: 'equal',
  splits: [{ userId: 'ana', amount: 500 }, { userId: 'beto', amount: 500 }],
  category: 'food', date: 0, createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false, ...over,
} as Expense);

const pago = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', groupId: 'g1', fromUserId: 'beto', toUserId: 'ana', amount: 500, currency: 'ARS',
  date: 0, createdAt: 0, createdById: 'beto', updatedAt: 0, isDeleted: false, ...over,
} as Payment);

describe('armarTimeline', () => {
  it('mezcla gastos y pagos del grupo, lo más nuevo primero', () => {
    const tl = armarTimeline(
      [gasto({ id: 'e1', date: 10 }), gasto({ id: 'e2', date: 30 })],
      [pago({ id: 'p1', date: 20 })],
      'g1',
    );
    expect(tl.map(i => `${i.type}:${i.data.id}`)).toEqual(['expense:e2', 'payment:p1', 'expense:e1']);
    expect(tl.map(i => i.ts)).toEqual([30, 20, 10]);
  });

  it('deja afuera lo de otros grupos y los tombstones', () => {
    const tl = armarTimeline(
      [gasto({ id: 'otro', groupId: 'g2' }), gasto({ id: 'borrado', isDeleted: true })],
      [pago({ id: 'p-otro', groupId: 'g2' }), pago({ id: 'p-borrado', isDeleted: true })],
      'g1',
    );
    expect(tl).toEqual([]);
  });

  it('sin registros devuelve lista vacía', () => {
    expect(armarTimeline([], [], 'g1')).toEqual([]);
  });

  it('sin id de grupo no matchea nada', () => {
    expect(armarTimeline([gasto()], [pago()], undefined)).toEqual([]);
  });
});

/**
 * T-225 (PO 2026-09-29): lo que me deben y lo que debo, sin compensar. Caso del
 * PO: con Ana, cuatro gastos a favor (200) y uno en contra (60).
 */
const casoDelPO = (): Expense[] => [
  ...[1, 2, 3, 4].map(i => gasto({
    id: `a${i}`, amount: 10_000, paidById: 'yo',
    splits: [{ userId: 'yo', amount: 5_000 }, { userId: 'ana', amount: 5_000 }],
  } as Partial<Expense>)),
  gasto({
    id: 'b1', amount: 12_000, paidById: 'ana',
    splits: [{ userId: 'yo', amount: 6_000 }, { userId: 'ana', amount: 6_000 }],
  } as Partial<Expense>),
];

describe('cuentasPorPersona', () => {
  it('caso del PO: Ana me debe 200 y yo le debo 60, sin compensar', () => {
    const deudas = deudasDeGrupo(casoDelPO(), [], grupo(['yo', 'ana']));
    expect(cuentasPorPersona(deudas, 'yo')).toEqual([{
      userId: 'ana',
      meDebe: [{ currency: 'ARS', amount: 20_000 }],
      leDebo: [{ currency: 'ARS', amount: 6_000 }],
    }]);
  });

  it('deja afuera a quien no tiene cuentas conmigo (deuda entre otros)', () => {
    const entreOtros = gasto({
      paidById: 'ana', splits: [{ userId: 'ana', amount: 500 }, { userId: 'beto', amount: 500 }],
    } as Partial<Expense>);
    const deudas = deudasDeGrupo([entreOtros], [], grupo(['yo', 'ana', 'beto']));
    expect(cuentasPorPersona(deudas, 'yo')).toEqual([]);
  });

  it('cada dirección baja sólo con su propio pago', () => {
    const pagoMio = pago({ fromUserId: 'yo', toUserId: 'ana', amount: 6_000 });
    const deudas = deudasDeGrupo(casoDelPO(), [pagoMio], grupo(['yo', 'ana']));
    expect(cuentasPorPersona(deudas, 'yo')).toEqual([{
      userId: 'ana', meDebe: [{ currency: 'ARS', amount: 20_000 }], leDebo: [],
    }]);
  });

  it('sin deudas, lista vacía', () => {
    expect(cuentasPorPersona([], 'yo')).toEqual([]);
  });
});
