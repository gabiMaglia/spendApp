import { deletionModeOf, borraAlInstante, puedeRestaurar } from '../deletionPolicy';
import type { Group } from '@/src/types/models';

const g = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Asado', memberIds: ['ana', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
  ...over,
} as Group);

describe('deletionModeOf', () => {
  it('un grupo viejo, sin el campo, cae al modo MAS restrictivo', () => {
    // Nunca se afloja solo: aflojar en retroactivo un acuerdo ya tomado seria
    // cambiar las reglas del grupo sin que nadie lo pida.
    expect(deletionModeOf(g())).toBe('consensus');
  });

  it('respeta el modo elegido al crear', () => {
    expect(deletionModeOf(g({ deletionMode: 'open' }))).toBe('open');
    expect(deletionModeOf(g({ deletionMode: 'consensus' }))).toBe('consensus');
  });
});

describe('borraAlInstante', () => {
  it('modo abierto: cualquier miembro borra al instante (como Splitwise)', () => {
    expect(borraAlInstante(g({ deletionMode: 'open' }), 'beto', 'ana')).toBe(true);
  });

  it('modo consenso: el creador del gasto SI borra al instante (override, regla #2)', () => {
    expect(borraAlInstante(g(), 'ana', 'ana')).toBe(true);
  });

  it('modo consenso: otro miembro NO — abre una ronda', () => {
    expect(borraAlInstante(g(), 'beto', 'ana')).toBe(false);
  });

  it('quien no es del grupo no borra, ni siquiera en modo abierto', () => {
    expect(borraAlInstante(g({ deletionMode: 'open' }), 'ajeno', 'ana')).toBe(false);
  });
});

describe('puedeRestaurar', () => {
  it('en modo abierto, cualquier miembro restaura — es la contraparte de borrar libre', () => {
    expect(puedeRestaurar(g({ deletionMode: 'open' }), 'beto')).toBe(true);
  });

  it('en modo consenso tambien: deshacer nunca puede ser mas dificil que hacer', () => {
    expect(puedeRestaurar(g(), 'beto')).toBe(true);
  });

  it('alguien de afuera del grupo no restaura', () => {
    expect(puedeRestaurar(g(), 'ajeno')).toBe(false);
  });
});
