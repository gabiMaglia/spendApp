import { mergeRecord, mergeByIdLevels } from '../mergeLevels';
import type { Expense } from '@/src/types/models';

/**
 * T-268 · Un registro NUEVO cuyo autor tiene el reloj adelantado se descartaba
 * y la rebanada igual quedaba «aplicada» (el cursor avanzaba): el gasto no
 * llegaba nunca. Ahora entra con la estampa acotada a `now` — `updatedAt` está
 * fuera de la firma, así que acotarlo no invalida nada.
 */
const NOW = 1_790_000_000_000;

const gasto = {
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 10_000, currency: 'ARS',
  paidById: 'ana', createdById: 'ana', splits: [], splitMode: 'equal', category: 'food',
  date: NOW - 1000, createdAt: NOW - 1000, updatedAt: NOW - 1000, isDeleted: false,
  rev: NOW - 1000, k: 'aa'.repeat(32), s: 'bb'.repeat(64),
} as unknown as Expense;

describe('mergeByIdLevels · id nuevo con reloj adelantado', () => {
  it('reloj +10 min: entra con updatedAt = now', () => {
    const nuevo = { ...gasto, id: 'e2', updatedAt: NOW + 10 * 60_000 };
    const out = mergeByIdLevels('expense', [gasto], [nuevo], NOW);
    expect(out).toHaveLength(2);
    expect(out[1]!.updatedAt).toBe(NOW);
  });

  it('dentro de la tolerancia queda intacto', () => {
    const nuevo = { ...gasto, id: 'e2', updatedAt: NOW + 60_000 };
    expect(mergeByIdLevels('expense', [gasto], [nuevo], NOW)[1]!.updatedAt).toBe(NOW + 60_000);
  });

  it('no muta el entrante', () => {
    const nuevo = { ...gasto, id: 'e2', updatedAt: 9e15 };
    mergeByIdLevels('expense', [gasto], [nuevo], NOW);
    expect(nuevo.updatedAt).toBe(9e15);
  });

  it('una edición honesta posterior le gana al registro acotado (no queda envenenado)', () => {
    const nuevo = { ...gasto, id: 'e2', description: 'X', updatedAt: 9e15 };
    const acotado = mergeByIdLevels('expense', [gasto], [nuevo], NOW)[1]!;
    const edicion = { ...nuevo, description: 'Y', updatedAt: NOW + 1 };
    expect(mergeRecord('expense', acotado, edicion, NOW + 1).updatedAt).toBe(NOW + 1);
  });

  it('re-recibir el mismo registro adelantado no pisa al ya acotado', () => {
    const nuevo = { ...gasto, id: 'e2', updatedAt: 9e15 };
    const una = mergeByIdLevels('expense', [gasto], [nuevo], NOW);
    const dos = mergeByIdLevels('expense', una, [nuevo], NOW + 5_000);
    expect(dos[1]!.updatedAt).toBe(NOW);
  });

  it('un updatedAt que no es número sigue sin entrar', () => {
    for (const basura of ['zzz', NaN, null, undefined]) {
      const nuevo = { ...gasto, id: 'e2', updatedAt: basura } as unknown as Expense;
      expect(mergeByIdLevels('expense', [gasto], [nuevo], NOW)).toHaveLength(1);
    }
  });
});
