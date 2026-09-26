import { mergeRecord, mergeByIdLevels } from '../mergeLevels';
import { enDisputa } from '@/src/algorithms/autoria';
import type { Expense } from '@/src/types/models';

/**
 * T-170 · D-2. El literal del backlog («autor distinto → el entrante no gana») no
 * converge (§2 del plan). Lo único convergente adentro del merge es REGISTRAR la
 * disputa; el poder de creador se decide afuera (T-169, `forcedTrust`).
 */
const NOW = 1_800_000_000_000;
const deAna = {
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 10_000, currency: 'ARS', paidById: 'ana',
  createdById: 'ana', splits: [], splitMode: 'equal', category: 'food', date: NOW - 10_000,
  createdAt: NOW - 10_000, updatedAt: NOW - 10_000, isDeleted: false, rev: NOW - 10_000,
  deletionVotes: [], k: 'aa'.repeat(32), s: 'bb'.repeat(64),
} as unknown as Expense;
const deMallory = { ...deAna, createdById: 'mallory', amount: 1, rev: NOW - 9_000,
  updatedAt: NOW - 9_000, k: 'cc'.repeat(32), s: 'dd'.repeat(64) } as Expense;
const deCarla = { ...deAna, createdById: 'carla', amount: 2, rev: NOW - 8_000,
  updatedAt: NOW - 8_000, k: 'ee'.repeat(32), s: 'ff'.repeat(64) } as Expense;

const aplicar = (orden: Expense[]): Expense =>
  orden.slice(1).reduce((acc, r) => mergeByIdLevels('expense', acc, [r], NOW), [orden[0]!])[0]!;

describe('D-2 · la autoría se disputa, no se gana', () => {
  it('T-170.1: autor distinto → los dos órdenes convergen con disputa [ana, mallory]', () => {
    const a = mergeRecord('expense', deAna, deMallory, NOW);
    const b = mergeRecord('expense', deMallory, deAna, NOW);
    expect(a).toEqual(b);
    expect(a.autoriaDisputada).toEqual(['ana', 'mallory']);
    expect(a.amount).toBe(1);      // el núcleo sigue por `rev`: R4, aceptado por el PO
    expect(enDisputa(a)).toBe(true);
  });

  it('I-2: tres autores, las seis permutaciones dan el mismo registro', () => {
    const perms: Expense[][] = [
      [deAna, deMallory, deCarla], [deAna, deCarla, deMallory], [deMallory, deAna, deCarla],
      [deMallory, deCarla, deAna], [deCarla, deAna, deMallory], [deCarla, deMallory, deAna],
    ];
    const salidas = perms.map(aplicar);
    for (const s of salidas) expect(s).toEqual(salidas[0]);
    expect(salidas[0]!.autoriaDisputada).toEqual(['ana', 'carla', 'mallory']);
  });

  it('T-170.2: edición del propio autor con rev+1 gana como hoy y no abre disputa', () => {
    const editado = { ...deAna, amount: 12_000, rev: (deAna.rev as number) + 1, s: '11'.repeat(64) } as Expense;
    const out = mergeRecord('expense', deAna, editado, NOW);
    expect(out.amount).toBe(12_000);
    expect(out.autoriaDisputada).toBeUndefined();
  });

  it('T-170.6 (dato): una disputa inyectada sin reescribir el núcleo sólo agrega la disputa', () => {
    const inyectado = { ...deAna, autoriaDisputada: ['ana', 'zed'] } as Expense;
    const out = mergeRecord('expense', deAna, inyectado, NOW);
    expect(out.amount).toBe(10_000);
    expect(out.createdById).toBe('ana');
    expect((out as { s?: string }).s).toBe((deAna as { s?: string }).s);
    expect(out.autoriaDisputada).toEqual(['ana', 'zed']);
  });

  it('sin cambios devuelve la MISMA referencia', () => {
    const disputado = mergeRecord('expense', deAna, deMallory, NOW);
    expect(mergeRecord('expense', disputado, deMallory, NOW)).toBe(disputado);
  });

  it('la disputa no entra al desempate del resto (es colaborativa, no LWW)', () => {
    const conOtraDisputa = { ...deAna, autoriaDisputada: ['ana', 'yyy'] } as Expense;
    const conDisputa = { ...deAna, autoriaDisputada: ['ana', 'zzz'] } as Expense;
    expect(mergeRecord('expense', conOtraDisputa, conDisputa, NOW).autoriaDisputada)
      .toEqual(['ana', 'yyy', 'zzz']);
  });
});

jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));
import * as errorLog from '@/src/services/errorLog';
import { useExpenseStore } from '../expenseStore';

it('P-1: un merge que ABRE una disputa deja rastro sync.autoria_disputada, una sola vez', () => {
  const espia = jest.spyOn(errorLog, 'recordError');
  useExpenseStore.setState({ expenses: [deAna] }); // en T-169 esto pasa a sembrarGastos
  useExpenseStore.getState().mergeExpenses([deMallory], NOW);
  useExpenseStore.getState().mergeExpenses([deMallory], NOW);
  const rastros = espia.mock.calls.filter(([e]) => e.message.startsWith('sync.autoria_disputada'));
  expect(rastros).toHaveLength(1);
  expect(rastros[0]![0].message).toBe('sync.autoria_disputada id=e1');
});
