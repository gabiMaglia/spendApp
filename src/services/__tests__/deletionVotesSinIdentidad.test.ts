import { emitirVoto } from '../deletionVotes';
import type { Expense } from '@/src/types/models';

/**
 * **La firma no puede romper la acción del usuario** (T-041 · S8, regla 3 de
 * `signOnWrite`).
 *
 * Si no hay identidad —o el módulo nativo no está en el build— el voto se emite
 * igual, sin firma, y queda `no_verificable`. Frenar un borrado no puede
 * depender de que la criptografía funcione: el costo de no poder objetar es que
 * el gasto de alguien desaparezca.
 *
 * Va en su propio archivo porque el mock tiene que estar hoisteado: un
 * `jest.doMock` adentro del test no llega a pisar el módulo (lección de S4).
 */
jest.mock('@/src/store/identityStore', () => ({
  ensureIdentity: () => { throw new Error('build sin el módulo de identidad'); },
}));

const gasto = { id: 'e1', deletionVotes: [], createdById: 'ana' } as unknown as Expense;

describe('sin identidad', () => {
  it('el voto sale igual, sin firma', () => {
    const votos = emitirVoto(gasto, 'beto', 'delete', 1_000);

    expect(votos).toHaveLength(1);
    expect(votos[0]!.k).toBeUndefined();
    expect(votos[0]!.s).toBeUndefined();
    expect(votos[0]!.roundId).toBeTruthy();
  });

  it('y frenar tampoco se bloquea', () => {
    const conPedido = { ...gasto, deletionVotes: emitirVoto(gasto, 'beto', 'delete', 1_000) };
    const votos = emitirVoto(conPedido, 'caro', 'object', 2_000);

    expect(votos).toHaveLength(2);
    expect(votos[1]!.action).toBe('cancel');
  });
});
