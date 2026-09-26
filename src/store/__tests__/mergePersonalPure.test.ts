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

/**
 * PO 2026-09-26 (T-171, ronda de fix 1) — «agregar, pero no pisar», SOLO
 * para `personal`: el riesgo es un reloj propio adelantado (no un atacante),
 * y perder un movimiento propio es peor que dejarlo envenenado un rato.
 * `users` (perfiles) NO cambia — sigue T-137 sin esta opción
 * (`mergeUsersLWW.test.ts`, 22 casos intactos).
 */
describe('mergePersonalPure — agregar pero no pisar (T-171 fix 1, PO 2026-09-26)', () => {
  it('un entrante futuro cuyo id NO EXISTE localmente se agrega: nunca se pierde un movimiento personal', () => {
    const out = mergePersonalPure(
      [],
      [entry({ id: 'e2', description: 'adelantado-nuevo', updatedAt: 9e15 })],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.description).toBe('adelantado-nuevo');
  });

  it('un entrante futuro cuyo id YA EXISTE no reemplaza al local', () => {
    const out = mergePersonalPure(
      [entry({ id: 'e1', description: 'local', updatedAt: 1_000 })],
      [entry({ id: 'e1', description: 'atacante', updatedAt: 9e15 })],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.description).toBe('local');
  });

  it('convergencia: un movimiento nuevo adelantado y uno legítimo posterior llegan en órdenes distintos y convergen', () => {
    // Ids DISTINTOS (ambos se agregan, no se reemplazan entre sí): el array
    // resultante puede quedar en distinto ORDEN según por dónde llegó cada
    // uno primero — eso es esperado en una lista. Lo que tiene que converger
    // es el CONTENIDO: mismos dos movimientos, mismos datos, en los dos
    // dispositivos.
    const adelantadoNuevo = entry({ id: 'e2', description: 'adelantado-nuevo', updatedAt: 9e15 });
    const legit = entry({ id: 'e3', description: 'legit', updatedAt: NOW + 1_000 });

    const device1 = mergePersonalPure(mergePersonalPure([], [adelantadoNuevo], NOW), [legit], NOW + 2_000);
    const device2 = mergePersonalPure(mergePersonalPure([], [legit], NOW + 2_000), [adelantadoNuevo], NOW + 2_000);

    const porId = (list: PersonalEntry[]) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(porId(device1)).toEqual(porId(device2));
    expect(device1.map(e => e.id).sort()).toEqual(['e2', 'e3']);
  });
});
