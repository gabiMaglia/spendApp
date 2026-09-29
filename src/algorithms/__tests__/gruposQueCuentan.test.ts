import { gruposQueCuentan } from '@/src/algorithms/gruposQueCuentan';
import type { Group } from '@/src/types/models';

/**
 * T-225: una sola regla de qué grupos cuentan para mis deudas. La usan los
 * casilleros y la tarjeta de Amigos (`selectoresDeDeuda`) Y la pantalla de
 * Saldar desde Amigos (`saldoSinCompensar`): si difirieran, Amigos ofrecería
 * saldar una deuda que Saldar no encuentra, o al revés.
 */
const g = (id: string, extra: Partial<Group> = {}): Group => ({
  id, name: id, memberIds: ['yo', 'ana'], currency: 'ARS', miembros: {},
  createdAt: 0, createdById: 'yo', updatedAt: 0, isDeleted: false, ...extra,
} as Group);

describe('gruposQueCuentan', () => {
  it('cuenta los grupos activos de los que soy parte', () => {
    expect(gruposQueCuentan([g('a'), g('b')], [], 'yo').map(x => x.id)).toEqual(['a', 'b']);
  });

  it('no cuenta borrados, archivados ni grupos ajenos', () => {
    const r = gruposQueCuentan(
      [g('borrado', { isDeleted: true }), g('archivado'), g('ajeno', { memberIds: ['ana', 'beto'] }), g('ok')],
      ['archivado'], 'yo',
    );
    expect(r.map(x => x.id)).toEqual(['ok']);
  });

  it('sin grupos, nada', () => {
    expect(gruposQueCuentan([], [], 'yo')).toEqual([]);
  });
});
