import { planMigracionReplicados } from '../migrateReplicated';
import type { Expense, PersonalEntry } from '@/src/types/models';

const YO = 'yo';

const gasto = (id: string, pagador: string, total = 1_000_000): Expense => ({
  id, groupId: 'g1', description: id, amount: total, currency: 'ARS',
  paidById: pagador,
  splits: [{ userId: YO, amount: total / 2, isPaid: false }, { userId: 'beto', amount: total / 2, isPaid: false }],
  splitMode: 'equal', category: 'food', date: 0, createdAt: 0, createdById: pagador,
  deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Expense);

const replica = (id: string, sourceId: string, amount: number): PersonalEntry => ({
  id, kind: 'group_replicated', description: 'x', amount, currency: 'ARS',
  category: 'food', date: 0, createdAt: 0, updatedAt: 0, isDeleted: false,
  sourceGroupExpenseId: sourceId,
} as PersonalEntry);

describe('migración de réplicas de grupo (ADR-006)', () => {
  it('si PAGUE yo, la réplica pasa a valer lo que puse ENTERO', () => {
    // Antes valia mi porcion (500.000). La plata que salio de mi bolsillo fue
    // el total: 1.000.000.
    const plan = planMigracionReplicados([replica('r1', 'e1', 500_000)], [gasto('e1', YO)], YO);
    expect(plan.actualizar).toEqual([{ id: 'r1', amount: 1_000_000 }]);
    expect(plan.borrar).toEqual([]);
  });

  it('si pago OTRO, la réplica se borra: todavía no gasté nada', () => {
    // Es una deuda, no un gasto. Se vuelve gasto recien cuando la salde.
    const plan = planMigracionReplicados([replica('r1', 'e1', 500_000)], [gasto('e1', 'beto')], YO);
    expect(plan.borrar).toEqual(['r1']);
    expect(plan.actualizar).toEqual([]);
  });

  it('si ya vale lo correcto, no se toca', () => {
    const plan = planMigracionReplicados([replica('r1', 'e1', 1_000_000)], [gasto('e1', YO)], YO);
    expect(plan.actualizar).toEqual([]);
    expect(plan.borrar).toEqual([]);
  });

  it('una réplica huérfana (su gasto ya no existe) NO se toca', () => {
    // No hay con que decidir. Borrarla seria destruir el unico rastro que
    // queda de algo que paso.
    const plan = planMigracionReplicados([replica('r1', 'perdido', 500_000)], [], YO);
    expect(plan.actualizar).toEqual([]);
    expect(plan.borrar).toEqual([]);
    expect(plan.huerfanas).toBe(1);
  });

  it('un gasto BORRADO cuenta como origen válido igual', () => {
    // El gasto puede estar borrado y su replica seguir siendo historia real.
    const plan = planMigracionReplicados(
      [replica('r1', 'e1', 500_000)], [{ ...gasto('e1', YO), isDeleted: true }], YO,
    );
    expect(plan.actualizar).toEqual([{ id: 'r1', amount: 1_000_000 }]);
  });

  it('ignora los movimientos que no son réplicas', () => {
    const manual = { ...replica('m1', 'e1', 999), kind: 'expense' } as PersonalEntry;
    const plan = planMigracionReplicados([manual], [gasto('e1', 'beto')], YO);
    expect(plan.borrar).toEqual([]);
    expect(plan.actualizar).toEqual([]);
  });

  it('sin nada que migrar, el plan queda vacío', () => {
    expect(planMigracionReplicados([], [], YO)).toEqual({ actualizar: [], borrar: [], huerfanas: 0 });
  });
});
