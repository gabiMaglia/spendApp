import { snapshot, noticesFor, esAccionable } from '../syncNotices';
import type { Group } from '@/src/types/models';

function grupo(over: Partial<Group> = {}): Group {
  return {
    id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
    createdAt: 1_000, updatedAt: 1_000, isDeleted: false,
    createdById: 'ana', deletionVotes: [],
    ...over,
  };
}

describe('aviso "group_replaced"', () => {
  it('se dispara cuando un grupo aparece con supersededByGroupId nuevo en esta bajada', () => {
    const antes = snapshot([], 1_000, [grupo()], []);
    const gruposDespues = [
      grupo({ supersededByGroupId: 'g2' }),
      grupo({ id: 'g2', name: 'Viaje (2)' }),
    ];

    const avisos = noticesFor(antes, [], gruposDespues, 'beto', 2_000, []);

    expect(avisos).toContainEqual({
      kind: 'group_replaced',
      groupId: 'g1',
      groupName: 'Viaje',
      newGroupId: 'g2',
      newGroupName: 'Viaje (2)',
    });
  });

  it('NO se dispara si supersededByGroupId ya estaba en la foto de antes (regla 3: sólo lo nuevo de esta bajada)', () => {
    const grupoYaTraspasado = grupo({ supersededByGroupId: 'g2' });
    const antes = snapshot([], 1_000, [grupoYaTraspasado, grupo({ id: 'g2', name: 'Viaje (2)' })], []);

    const avisos = noticesFor(antes, [], [grupoYaTraspasado, grupo({ id: 'g2', name: 'Viaje (2)' })], 'beto', 2_000, []);

    expect(avisos.filter(a => a.kind === 'group_replaced')).toHaveLength(0);
  });

  it('NO se dispara para un grupo borrado', () => {
    const antes = snapshot([], 1_000, [grupo()], []);
    const gruposDespues = [grupo({ supersededByGroupId: 'g2', isDeleted: true })];

    const avisos = noticesFor(antes, [], gruposDespues, 'beto', 2_000, []);

    expect(avisos.filter(a => a.kind === 'group_replaced')).toHaveLength(0);
  });

  it('esAccionable("group_replaced") es false — es informativo', () => {
    expect(esAccionable('group_replaced')).toBe(false);
  });
});
