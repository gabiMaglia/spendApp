import { motivoDeExceso } from '../topeDeRegistro';
import { MAX_MIEMBROS } from '@/src/sync/topes';

/**
 * T-178: el mismo predicado que hoy sólo corre al recibir/publicar (`excesoDe`,
 * `src/sync/topes.ts`) tiene que correr TAMBIÉN antes de escribir en el store,
 * para que el usuario vea por qué no se guardó en vez de que el registro
 * quede huérfano en su teléfono.
 */
describe('motivoDeExceso', () => {
  it('R1: un gasto normal no excede nada', () => {
    const gasto = {
      id: 'e1',
      description: 'Almuerzo',
      amount: 1000,
      isDeleted: false,
    };
    expect(motivoDeExceso(gasto)).toBeNull();
  });

  it('R2: un registro cuyo JSON supera MAX_REGISTRO_BYTES devuelve la clave de bytes', () => {
    const gasto = {
      id: 'e2',
      description: 'x',
      note: 'a'.repeat(300_000),
      isDeleted: false,
    };
    expect(motivoDeExceso(gasto)).toBe('sync.record_too_big_bytes');
  });

  it('R3: un grupo con más de MAX_MIEMBROS ids devuelve la clave de miembros', () => {
    const grupo = {
      id: 'g1',
      name: 'Grupo grande',
      memberIds: Array.from({ length: MAX_MIEMBROS + 1 }, (_, i) => `u${i}`),
      isDeleted: false,
    };
    expect(motivoDeExceso(grupo)).toBe('sync.record_too_big_members');
  });

  it('no revienta con undefined/null/valores no-objeto', () => {
    expect(motivoDeExceso(undefined)).toBeNull();
    expect(motivoDeExceso(null)).toBeNull();
    expect(motivoDeExceso('x')).toBeNull();
  });
});
