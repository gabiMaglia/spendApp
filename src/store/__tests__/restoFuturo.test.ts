import { mergeRecord, mergeByIdLevels } from '../mergeLevels';
import { TOLERANCIA_RELOJ_MS } from '@/src/sync/voteCore';
import type { Expense, Group } from '@/src/types/models';

/**
 * SEC-02 (T-142b / T-144). El nivel «resto» del merge (`isDeleted`,
 * `memberIds`, `name`…) era LWW por `updatedAt` sin techo. Un peer con la clave
 * del grupo republicaba un registro con `updatedAt: 9e15` y ganaba PARA
 * SIEMPRE: el autor no podía restaurar su gasto, el expulsado no podía volver
 * a entrar, el grupo no recuperaba su nombre. T-137 lo había cerrado sólo
 * para perfiles. Casos SEC-B y SEC-D del PoC de la auditoría, invertidos.
 */
const NOW = 1_790_000_000_000;

const gastoDeAna = {
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 10_000, currency: 'ARS',
  paidById: 'ana', createdById: 'ana', splits: [], splitMode: 'equal', category: 'food',
  date: NOW - 1000, createdAt: NOW - 1000, updatedAt: NOW - 1000, isDeleted: false,
  rev: NOW - 1000, k: 'aa'.repeat(32), s: 'bb'.repeat(64),
} as unknown as Expense;

const grupo = {
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto', 'mallory'], createdById: 'ana',
  createdAt: NOW - 5000, updatedAt: NOW - 5000, isDeleted: false, deletionMode: 'consensus',
  currency: 'ARS', deletionVotes: [],
} as unknown as Group;

describe('SEC-B · un tombstone con updatedAt del futuro', () => {
  it('no gana el resto', () => {
    const deMallory = { ...gastoDeAna, isDeleted: true, updatedAt: 9e15 };
    expect(mergeRecord('expense', gastoDeAna, deMallory, NOW).isDeleted).toBe(false);
  });

  it('y si ya había entrado (antes de este fix), la primera edición honesta lo sana', () => {
    const envenenadoLocal = { ...gastoDeAna, isDeleted: true, updatedAt: 9e15 };
    const restauraAna = { ...gastoDeAna, isDeleted: false, updatedAt: NOW + 60_000 };
    const despues = mergeRecord('expense', envenenadoLocal, restauraAna, NOW);
    expect(despues.isDeleted).toBe(false);
    expect(despues.updatedAt).toBe(NOW + 60_000);
  });

  it('justo en el borde de la tolerancia todavía cuenta; un ms más allá, no', () => {
    const borde = { ...gastoDeAna, isDeleted: true, updatedAt: NOW + TOLERANCIA_RELOJ_MS };
    expect(mergeRecord('expense', gastoDeAna, borde, NOW).isDeleted).toBe(true);
    const pasado = { ...gastoDeAna, isDeleted: true, updatedAt: NOW + TOLERANCIA_RELOJ_MS + 1 };
    expect(mergeRecord('expense', gastoDeAna, pasado, NOW).isDeleted).toBe(false);
  });

  it('un updatedAt que no es número tampoco gana (D2 de T-137, misma puerta)', () => {
    for (const basura of ['zzz', NaN, null, undefined]) {
      const raro = { ...gastoDeAna, isDeleted: true, updatedAt: basura } as unknown as Expense;
      expect(mergeRecord('expense', gastoDeAna, raro, NOW).isDeleted).toBe(false);
    }
  });
});

describe('SEC-D · memberIds con updatedAt del futuro', () => {
  it('no expulsa a nadie', () => {
    const deMallory = { ...grupo, memberIds: ['mallory'], updatedAt: 9e15 };
    expect(mergeRecord('group', grupo, deMallory, NOW).memberIds).toEqual(['ana', 'beto', 'mallory']);
  });

  it('y un grupo ya envenenado se sana con la primera versión plausible', () => {
    const envenenadoLocal = { ...grupo, memberIds: ['mallory'], updatedAt: 9e15 };
    const arreglaAna = { ...grupo, updatedAt: NOW + 60_000 };
    expect(mergeRecord('group', envenenadoLocal, arreglaAna, NOW).memberIds)
      .toEqual(['ana', 'beto', 'mallory']);
  });
});

describe('el núcleo sigue mandando por rev, no por fecha', () => {
  it('un núcleo con rev mayor gana aunque su updatedAt esté envenenado (el resto, no)', () => {
    const inc = { ...gastoDeAna, amount: 999, rev: gastoDeAna.rev! + 1, isDeleted: true, updatedAt: 9e15 };
    const out = mergeRecord('expense', gastoDeAna, inc, NOW);
    expect(out.amount).toBe(999);        // núcleo: gana por rev
    expect(out.isDeleted).toBe(false);   // resto: el updatedAt envenenado no gana
    expect(out.updatedAt).toBe(gastoDeAna.updatedAt);
  });
});

describe('mergeByIdLevels con ids nuevos', () => {
  it('un registro nuevo con updatedAt envenenado no se agrega', () => {
    const nuevo = { ...gastoDeAna, id: 'e2', updatedAt: 9e15 };
    expect(mergeByIdLevels('expense', [gastoDeAna], [nuevo], NOW)).toHaveLength(1);
  });

  it('el mismo registro con updatedAt plausible sí', () => {
    const nuevo = { ...gastoDeAna, id: 'e2', updatedAt: NOW };
    expect(mergeByIdLevels('expense', [gastoDeAna], [nuevo], NOW)).toHaveLength(2);
  });

  it('el orden de llegada no cambia el resultado', () => {
    const veneno = { ...gastoDeAna, isDeleted: true, updatedAt: 9e15 };
    const honesto = { ...gastoDeAna, description: 'Cena editada', updatedAt: NOW - 10 };
    const a = mergeByIdLevels('expense', [gastoDeAna], [veneno, honesto], NOW);
    const b = mergeByIdLevels('expense', [gastoDeAna], [honesto, veneno], NOW);
    expect(a).toEqual(b);
    expect(a[0]!.isDeleted).toBe(false);
  });
});
