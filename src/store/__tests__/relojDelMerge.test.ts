import { envenenado, siguienteUpdatedAt } from '../relojDelMerge';
import { TOLERANCIA_RELOJ_MS } from '@/src/sync/voteCore';

const NOW = 1_790_000_000_000;

describe('envenenado — un updatedAt que no pudo haber pasado todavía', () => {
  it('dentro de la tolerancia no lo es', () => {
    expect(envenenado(NOW, NOW)).toBe(false);
    expect(envenenado(NOW + TOLERANCIA_RELOJ_MS, NOW)).toBe(false);
    expect(envenenado(0, NOW)).toBe(false);
  });
  it('más allá de la tolerancia lo es', () => {
    expect(envenenado(NOW + TOLERANCIA_RELOJ_MS + 1, NOW)).toBe(true);
    expect(envenenado(9e15, NOW)).toBe(true);
  });
  it('lo que no es un número finito lo es (D2 de T-137)', () => {
    for (const basura of ['zzz', NaN, Infinity, -Infinity, null, undefined, {}]) {
      expect(envenenado(basura, NOW)).toBe(true);
    }
  });
});

describe('siguienteUpdatedAt — la estampa de una escritura propia', () => {
  it('sin previo es now', () => {
    expect(siguienteUpdatedAt(undefined, NOW)).toBe(NOW);
  });
  it('con un previo plausible es estrictamente mayor que él, incluso en el mismo ms', () => {
    expect(siguienteUpdatedAt(NOW, NOW)).toBe(NOW + 1);
    expect(siguienteUpdatedAt(NOW - 500, NOW)).toBe(NOW);
    expect(siguienteUpdatedAt(NOW + 60_000, NOW)).toBe(NOW + 60_001); // el otro tenía el reloj 1 min adelante
  });
  it('con un previo envenenado NO arrastra el veneno: vuelve a now', () => {
    expect(siguienteUpdatedAt(9e15, NOW)).toBe(NOW);
    expect(siguienteUpdatedAt(NaN, NOW)).toBe(NOW);
  });
});
