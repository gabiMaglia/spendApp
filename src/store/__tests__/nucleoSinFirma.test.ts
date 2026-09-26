import { mergeRecord, coreWins } from '../mergeLevels';
import type { Expense } from '@/src/types/models';

/**
 * SEC-08 (T-142b / T-152, DEC-05 del PO). Con R1 la autoría se marca y no se
 * rechaza; pero `coreWins` ordenaba sólo por `rev`, así que un núcleo SIN
 * firma con `rev` gigante pisaba el monto firmado del autor y quedaba como
 * «no verificable», no como «inválido». La regla intermedia: un núcleo sin
 * firma nunca le gana a uno firmado. No enciende la fase B — dos núcleos sin
 * firma se siguen ordenando por `rev`/`updatedAt` como siempre.
 */
const NOW = 1_790_000_000_000;
const firmado = {
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 10_000, currency: 'ARS', paidById: 'ana',
  createdById: 'ana', splits: [], splitMode: 'equal', category: 'food', date: NOW - 1000,
  createdAt: NOW - 1000, updatedAt: NOW - 1000, isDeleted: false, rev: NOW - 1000,
  k: 'aa'.repeat(32), s: 'bb'.repeat(64),
} as unknown as Expense;
const sinFirma = (over: Partial<Expense>): Expense => {
  const { k: _k, s: _s, ...resto } = firmado as Expense & { k?: string; s?: string };
  return { ...resto, ...over } as Expense;
};

it('PoC SEC-C invertido: un núcleo sin firma con rev gigante NO pisa el monto firmado', () => {
  const out = mergeRecord('expense', firmado, sinFirma({ amount: 1, rev: 9e15 }), NOW);
  expect(out.amount).toBe(10_000);
  expect((out as { k?: string }).k).toBe((firmado as { k?: string }).k);
});

it('es simétrica: desde el otro lado, el firmado entrante le gana al local sin firma aunque tenga rev menor', () => {
  const local = sinFirma({ amount: 1, rev: 9e15 });
  expect(mergeRecord('expense', local, firmado, NOW).amount).toBe(10_000);
});

it('los dos órdenes de llegada convergen', () => {
  const a = mergeRecord('expense', firmado, sinFirma({ amount: 1, rev: 9e15 }), NOW);
  const b = mergeRecord('expense', sinFirma({ amount: 1, rev: 9e15 }), firmado, NOW);
  expect(a).toEqual(b);
});

it('dos núcleos sin firma se siguen ordenando por rev (peers pre-T-041, registros derivados)', () => {
  expect(coreWins('expense', sinFirma({ amount: 2, rev: 3 }), sinFirma({ amount: 1, rev: 2 }))).toBe(true);
  expect(coreWins('expense', sinFirma({ amount: 2, rev: 1 }), sinFirma({ amount: 1, rev: 2 }))).toBe(false);
});

it('dos núcleos firmados se siguen ordenando por rev', () => {
  const otro = { ...firmado, amount: 500, rev: (firmado as { rev: number }).rev + 1, s: 'cc'.repeat(64) } as Expense;
  expect(coreWins('expense', otro, firmado)).toBe(true);
});

it('una firma vacía (k o s en blanco) cuenta como sin firma', () => {
  const vacia = { ...firmado, amount: 1, rev: 9e15, k: '', s: '' } as Expense;
  expect(mergeRecord('expense', firmado, vacia, NOW).amount).toBe(10_000);
});
