import { unirMiembros, rosterDe, conAlta, conBaja } from '../roster';
import { TOLERANCIA_RELOJ_MS } from '@/src/store/relojDelMerge';
import type { Group } from '@/src/types/models';

/**
 * T-182 (simplificado) — roster por miembro, no por lista. Ver `roster.ts`
 * para el problema que reemplaza (`memberIds` LWW entero).
 */
const NOW = 1_790_000_000_000;

const base = (miembros: Group['miembros'] = {}): Group => ({
  id: 'g1', name: 'Viaje', memberIds: [], miembros, currency: 'ARS',
  createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false,
} as Group);

describe('R1 · crear grupo {A,B,C}', () => {
  it('los tres quedan in y memberIds = [A,B,C], en orden de alta', () => {
    let g = base();
    g = conAlta(g, 'A', 1);
    g = conAlta(g, 'B', 2);
    g = conAlta(g, 'C', 3);

    expect(g.miembros).toEqual({
      A: { estado: 'in', at: 1 }, B: { estado: 'in', at: 2 }, C: { estado: 'in', at: 3 },
    });
    expect(g.memberIds).toEqual(['A', 'B', 'C']);
  });
});

describe('R4 · X sale y vuelve a entrar', () => {
  it('X termina in con el `at` de la reentrada', () => {
    const local: Group['miembros'] = { X: { estado: 'out', at: 10 } };
    const g = conAlta(base(local), 'X', 20);
    expect(g.miembros.X).toEqual({ estado: 'in', at: 20 });
    expect(g.memberIds).toEqual(['X']);
  });
});

describe('unirMiembros — gana el `at` mayor por clave (R2/R3)', () => {
  it('un alta más nueva en un lado gana sobre una baja más vieja del otro', () => {
    const a: Group['miembros'] = { X: { estado: 'out', at: 10 } };
    const b: Group['miembros'] = { X: { estado: 'in', at: 1 } };
    // la baja (t=10) es más nueva que el alta (t=1): la baja gana
    expect(unirMiembros(a, b, NOW).X).toEqual({ estado: 'out', at: 10 });
  });

  it('altas concurrentes de dos personas distintas: las dos entran', () => {
    const a: Group['miembros'] = { Y: { estado: 'in', at: 5 } };
    const b: Group['miembros'] = { Z: { estado: 'in', at: 6 } };
    expect(unirMiembros(a, b, NOW)).toEqual({
      Y: { estado: 'in', at: 5 }, Z: { estado: 'in', at: 6 },
    });
  });
});

describe('R6 · `at` envenenado (T-144)', () => {
  it('un `at` más allá de la tolerancia se ignora: no entra ni gana', () => {
    const a: Group['miembros'] = { X: { estado: 'out', at: 10 } };
    const b: Group['miembros'] = { X: { estado: 'in', at: NOW + TOLERANCIA_RELOJ_MS + 1 } };
    expect(unirMiembros(a, b, NOW).X).toEqual({ estado: 'out', at: 10 });
  });

  it('un id NUEVO con `at` envenenado no entra al roster', () => {
    const a: Group['miembros'] = {};
    const b: Group['miembros'] = { Mallory: { estado: 'in', at: NOW + TOLERANCIA_RELOJ_MS + 1 } };
    expect(unirMiembros(a, b, NOW)).toEqual({});
  });

  it('un local ya envenenado sana con cualquier entrante plausible', () => {
    const a: Group['miembros'] = { X: { estado: 'in', at: 9e15 } };
    const b: Group['miembros'] = { X: { estado: 'out', at: NOW } };
    expect(unirMiembros(a, b, NOW).X).toEqual({ estado: 'out', at: NOW });
  });
});

describe('R7 · mismos sobres en distinto orden → mismo resultado (property, 100 permutaciones)', () => {
  function shuffle<T>(arr: T[], seed: number): T[] {
    const out = [...arr];
    let s = seed;
    for (let i = out.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const j = s % (i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  it('100 permutaciones del mismo conjunto de sobres convergen al mismo roster', () => {
    const sobres: Group['miembros'][] = [
      { A: { estado: 'in', at: 1 } },
      { A: { estado: 'out', at: 5 } },
      { B: { estado: 'in', at: 2 } },
      { A: { estado: 'in', at: 5 } }, // mismo `at` que la baja: desempata por contenido, pero es EL MISMO en las 100 vueltas
      { C: { estado: 'in', at: 3 } },
      { B: { estado: 'out', at: 10 } },
    ];

    const referencia = sobres.reduce<Group['miembros']>((acc, s) => unirMiembros(acc, s, NOW), {});

    for (let seed = 0; seed < 100; seed++) {
      const permutado = shuffle(sobres, seed);
      const resultado = permutado.reduce<Group['miembros']>((acc, s) => unirMiembros(acc, s, NOW), {});
      expect(resultado).toEqual(referencia);
    }
  });
});

describe('rosterDe', () => {
  it('sólo los `in`, ordenados por `at` y después por id', () => {
    const miembros: Group['miembros'] = {
      Z: { estado: 'in', at: 1 }, Y: { estado: 'in', at: 1 }, X: { estado: 'out', at: 2 },
    };
    expect(rosterDe(miembros)).toEqual(['Y', 'Z']);
  });

  it('roster vacío → lista vacía', () => {
    expect(rosterDe({})).toEqual([]);
  });
});

describe('R5 · conBaja', () => {
  it('deja a X out y fuera de memberIds', () => {
    let g = base();
    g = conAlta(g, 'ana', 1);
    g = conAlta(g, 'X', 2);
    g = conBaja(g, 'X', 3);

    expect(g.miembros.X).toEqual({ estado: 'out', at: 3 });
    expect(g.memberIds).toEqual(['ana']);
  });
});
