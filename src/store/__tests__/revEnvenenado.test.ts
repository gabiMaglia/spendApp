import { coreWins, mergeRecord } from '../mergeLevels';
import { TOLERANCIA_RELOJ_MS } from '@/src/store/relojDelMerge';
import { siguienteRev } from '@/src/sync/signOnWrite';
import { clearClockOffset } from '@/src/utils/syncedClock';
import type { Expense } from '@/src/types/models';

/**
 * T-170 criterio 3. `rev` sale de `max(syncedNow(), prev+1)`: uno más allá de
 * `now + TOLERANCIA` no lo produce nadie honesto. Sin este tope, Mallory pone
 * `rev: 9e15` y el autor genuino no recupera su núcleo re-editando.
 */
const NOW = 1_800_000_000_000;
const deAna = {
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 10_000, currency: 'ARS', paidById: 'ana',
  createdById: 'ana', splits: [], splitMode: 'equal', category: 'food', date: NOW - 10_000,
  createdAt: NOW - 10_000, updatedAt: NOW - 10_000, isDeleted: false, rev: NOW - 10_000, k: 'aa'.repeat(32), s: 'bb'.repeat(64),
} as unknown as Expense;
const veneno = { ...deAna, createdById: 'mallory', amount: 1, rev: NOW + TOLERANCIA_RELOJ_MS + 1,
  k: 'cc'.repeat(32), s: 'dd'.repeat(64) } as Expense;

it('T-170.3a: un núcleo entrante con rev envenenado no gana', () => {
  expect(coreWins('expense', veneno, deAna, NOW)).toBe(false);
  expect(mergeRecord('expense', deAna, veneno, NOW).amount).toBe(10_000);
});

it('T-170.3b: un local envenenado pierde contra un entrante plausible', () => {
  expect(coreWins('expense', deAna, veneno, NOW)).toBe(true);
  expect(mergeRecord('expense', veneno, deAna, NOW).amount).toBe(10_000);
});

it('los dos órdenes convergen (con la disputa incluida)', () => {
  const a = mergeRecord('expense', deAna, veneno, NOW);
  const b = mergeRecord('expense', veneno, deAna, NOW);
  expect(a).toEqual(b);
  expect(a.autoriaDisputada!.map(n => n.createdById).sort()).toEqual(['ana', 'mallory']);
});

it('un rev dentro de la tolerancia sigue ganando como siempre', () => {
  const adelantado = { ...deAna, amount: 5, rev: NOW + TOLERANCIA_RELOJ_MS - 1, s: '22'.repeat(64) } as Expense;
  expect(coreWins('expense', adelantado, deAna, NOW)).toBe(true);
});

it('NaN e Infinity cuentan como envenenados', () => {
  expect(coreWins('expense', { ...veneno, rev: Number.NaN } as Expense, deAna, NOW)).toBe(false);
  expect(coreWins('expense', { ...veneno, rev: Infinity } as Expense, deAna, NOW)).toBe(false);
});

it('T-152 va primero: un sin-firma plausible no le gana a un firmado envenenado', () => {
  const { k: _k, s: _s, ...sinFirma } = deAna as Expense & { k?: string; s?: string };
  expect(coreWins('expense', sinFirma as Expense, veneno, NOW)).toBe(false);
});

it('dos envenenados: manda el rev como hoy (exactamente un sentido gana)', () => {
  const otro = { ...veneno, rev: NOW + 2 * TOLERANCIA_RELOJ_MS } as Expense;
  expect(coreWins('expense', otro, veneno, NOW)).toBe(true);
  expect(coreWins('expense', veneno, otro, NOW)).toBe(false);
});

describe('siguienteRev no arrastra el veneno (G8)', () => {
  beforeEach(() => { clearClockOffset(); jest.spyOn(Date, 'now').mockReturnValue(NOW); });
  afterEach(() => jest.restoreAllMocks());

  it('un previo envenenado vuelve a now', () => { expect(siguienteRev(9e15)).toBe(NOW); });
  it('un previo plausible adelantado sigue siendo prev+1', () => {
    expect(siguienteRev(NOW + TOLERANCIA_RELOJ_MS - 1)).toBe(NOW + TOLERANCIA_RELOJ_MS);
  });
  it('un previo viejo o ausente da now', () => {
    expect(siguienteRev(NOW - 5)).toBe(NOW);
    expect(siguienteRev(undefined)).toBe(NOW);
  });
});
