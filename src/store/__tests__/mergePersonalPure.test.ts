import { mergePersonalPure } from '../mergePersonalPure';
import type { PersonalEntry } from '@/src/types/models';

/**
 * T-171 (desde `engram/qa/T-144-verifier.md`) — `mergePersonalPure` usaba
 * `mergeByIdLWW` (`lww.ts`) sin tope de reloj: un `updatedAt: 9e15` ganaba
 * para siempre, porque ninguna edición honesta (`syncedNow()`) puede superar
 * numéricamente ese valor. `personalStore.mergeEntries`, `backup.ts` y la
 * fusión de cuentas (`accountLink.mergeAccounts`) pasan por acá — las tres
 * puertas quedan cerradas de una vez.
 */
const NOW = 1_700_000_000_000;

const entry = (over: Partial<PersonalEntry> = {}): PersonalEntry => ({
  id: 'e1', kind: 'expense', description: 'Café', amount: 500, currency: 'ARS',
  category: 'food', date: 0, createdAt: 0, updatedAt: 1_000, isDeleted: false,
  ...over,
} as PersonalEntry);

describe('mergePersonalPure — tope de reloj (T-171)', () => {
  it('un entrante con updatedAt futuro no gana', () => {
    const out = mergePersonalPure(
      [entry({ description: 'local', updatedAt: 1_000 })],
      [entry({ description: 'atacante', updatedAt: 9e15 })],
      NOW,
    );
    expect(out[0]!.description).toBe('local');
  });

  it('PoC del hallazgo: el ataque NO se impone sobre una edición legítima posterior', () => {
    const atacado = mergePersonalPure(
      [entry({ amount: 100, updatedAt: 1_000 })],
      [entry({ amount: 999999, updatedAt: 9e15 })],
      NOW,
    );
    // El ataque no ganó (a diferencia del PoC pre-fix).
    expect(atacado[0]!.amount).toBe(100);

    const real = mergePersonalPure(atacado, [entry({ amount: 42, updatedAt: NOW + 1_000 })], NOW + 2_000);
    expect(real[0]!.amount).toBe(42);
  });

  it('un local ya envenenado se autocura ante cualquier entrante plausible', () => {
    const out = mergePersonalPure(
      [entry({ description: 'vandalizado', updatedAt: 9e15 })],
      [entry({ description: 'real', updatedAt: 500 })],
      NOW,
    );
    expect(out[0]!.description).toBe('real');
  });

  it('un updatedAt no numérico cuenta como envenenado', () => {
    const out = mergePersonalPure(
      [entry({ description: 'local', updatedAt: 1_000 })],
      [{ ...entry({ description: 'basura' }), updatedAt: NaN }],
      NOW,
    );
    expect(out[0]!.description).toBe('local');
  });

  it('convergencia: dos aparatos con orden de llegada distinto terminan iguales', () => {
    const base = [entry({ description: 'inicial', updatedAt: 500 })];
    const ataque = entry({ description: 'atacante', updatedAt: 9e15 });
    const legit = entry({ description: 'real', updatedAt: NOW + 1_000 });

    const device1 = mergePersonalPure(mergePersonalPure(base, [ataque], NOW), [legit], NOW + 2_000);
    const device2 = mergePersonalPure(mergePersonalPure(base, [legit], NOW + 2_000), [ataque], NOW + 2_000);

    expect(device1).toEqual(device2);
    expect(device1[0]!.description).toBe('real');
  });
});
