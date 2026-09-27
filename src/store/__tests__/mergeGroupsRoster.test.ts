import { mergeGroupsPure } from '../mergeGroupsPure';
import type { Group } from '@/src/types/models';

/**
 * T-182 (simplificado) — integración: `mergeGroupsPure` une `miembros` POR
 * CLAVE (`unirMiembros`, colaborativo en `mergeLevels.ts`) y recalcula
 * `memberIds = rosterDe(miembros)` después.
 */
const NOW = 1_790_000_000_000;

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Viaje', memberIds: [], miembros: {}, currency: 'ARS',
  createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false,
  ...over,
} as Group);

describe('R2 · carrera honesta: salida vs. renombre concurrente sin verla', () => {
  it('X queda out y fuera de memberIds; el nombre nuevo se conserva', () => {
    // Teléfono A: X salió a t=10.
    const enA = grupo({
      name: 'Viaje',
      miembros: { ana: { estado: 'in', at: 0 }, X: { estado: 'out', at: 10 } },
      memberIds: ['ana'],
      updatedAt: 5,
    });
    // Teléfono B: nunca vio la salida (X sigue `in` desde t=1), pero renombró
    // el grupo con un `updatedAt` MÁS NUEVO que el de A.
    const deB = grupo({
      name: 'Viaje 2026',
      miembros: { ana: { estado: 'in', at: 0 }, X: { estado: 'in', at: 1 } },
      memberIds: ['ana', 'X'],
      updatedAt: 11,
    });

    const [fusionado] = mergeGroupsPure([enA], [deB], NOW);

    expect(fusionado!.name).toBe('Viaje 2026'); // el renombre (resto, LWW) sí gana
    expect(fusionado!.miembros.X).toEqual({ estado: 'out', at: 10 }); // pero no revive a X
    expect(fusionado!.memberIds).toEqual(['ana']);
  });
});

describe('R3 · altas concurrentes de dos personas distintas', () => {
  it('las dos entran', () => {
    const enA = grupo({
      miembros: { ana: { estado: 'in', at: 0 }, Y: { estado: 'in', at: 5 } },
      memberIds: ['ana', 'Y'],
    });
    const deB = grupo({
      miembros: { ana: { estado: 'in', at: 0 }, Z: { estado: 'in', at: 6 } },
      memberIds: ['ana', 'Z'],
    });

    const [fusionado] = mergeGroupsPure([enA], [deB], NOW);

    expect(fusionado!.memberIds.sort()).toEqual(['Y', 'Z', 'ana']);
  });
});

describe('un grupo nuevo (id que no existía) con `at` plausible sí entra', () => {
  it('memberIds sale de `miembros`, no del array publicado', () => {
    const nuevo = grupo({
      id: 'g2',
      miembros: { ana: { estado: 'in', at: 0 }, beto: { estado: 'in', at: 1 } },
      // `memberIds` publicado "mintiendo" (vacío): el merge lo ignora — sale
      // de `miembros`, nunca del array que viaja.
      memberIds: [],
    });

    const [fusionado] = mergeGroupsPure([], [nuevo], NOW);
    expect(fusionado!.memberIds).toEqual(['ana', 'beto']);
  });
});
