import { mergeUsersLWW } from '../mergeUsersLWW';
import { TOLERANCIA_RELOJ_MS } from '@/src/sync/voteCore';
import type { User } from '@/src/types/models';

/**
 * **T-137 (ADR-012, opción 1) — un `updatedAt` del futuro no gana.**
 *
 * Residual D3 de T-132 (`engram/qa/T-132-verifier.md` vuelta 2): sin tope,
 * `mergeUsers` es LWW puro por `updatedAt`, así que un co-miembro que manda un
 * perfil con `updatedAt: 9e15` vandaliza el nombre/foto de cualquiera **para
 * siempre** — el dueño nunca vuelve a ganar, porque su próxima edición real
 * jamás va a tener un timestamp mayor a `9e15`. Esto invalidaba la premisa
 * «reversible» de T-091 (`src/store/userStore.ts:70-77`).
 *
 * Mismo criterio que `enElFuturo` de los votos de borrado
 * (`src/sync/voteCore.ts:65-67`): un `updatedAt` más de `TOLERANCIA_RELOJ_MS`
 * por delante de `now` no pudo haber pasado todavía, así que no puede ganar
 * como "más nuevo". No se descarta el registro — sólo deja de ganar por fecha.
 */
const NOW = 1_700_000_000_000;

const user = (over: Partial<User> = {}): User => ({
  id: 'carol', name: 'Carol', email: 'carol@x.com', authProvider: 'google',
  createdAt: 0, updatedAt: 1_000, isDeleted: false, ...over,
});

describe('mergeUsersLWW — el futuro no gana (T-137 / ADR-012)', () => {
  it('caso feliz: un entrante más nuevo (no futuro) reemplaza al local', () => {
    const current = [user({ name: 'Carol', updatedAt: 1_000 })];
    const incoming = [user({ name: 'Carol G', updatedAt: 2_000 })];

    const out = mergeUsersLWW(current, incoming, NOW);
    expect(out.find(u => u.id === 'carol')!.name).toBe('Carol G');
  });

  it('D3 — vandalizado con updatedAt: 9e15 y DESPUÉS el real: el real gana', () => {
    const current = [user({ name: 'Carol', updatedAt: 1_000 })];

    // Primer sobre: el ataque. updatedAt absurdo, muy por delante de "ahora".
    const tras_ataque = mergeUsersLWW(current, [user({ name: 'Vandalizada', updatedAt: 9e15 })], NOW);
    // El ataque NO gana: el perfil local sigue como estaba.
    expect(tras_ataque.find(u => u.id === 'carol')!.name).toBe('Carol');

    // Segundo sobre: la edición real y legítima de Carol, con timestamp plausible.
    const tras_real = mergeUsersLWW(tras_ataque, [user({ name: 'Carol Real', updatedAt: NOW + 1_000 })], NOW + 2_000);
    expect(tras_real.find(u => u.id === 'carol')!.name).toBe('Carol Real');
  });

  it('un entrante NUEVO (no existía) con updatedAt futuro no se agrega', () => {
    const out = mergeUsersLWW([], [user({ id: 'beto', updatedAt: 9e15 })], NOW);
    expect(out.find(u => u.id === 'beto')).toBeUndefined();
  });

  it('un local ya envenenado en el futuro pierde contra cualquier entrante plausible, aunque tenga updatedAt MENOR', () => {
    // Carol ya quedó con updatedAt: 9e15 en un sync viejo (antes del fix).
    const current = [user({ name: 'Vandalizada', updatedAt: 9e15 })];
    // El entrante real es MÁS VIEJO en término absoluto, pero es plausible (no futuro).
    const incoming = [user({ name: 'Carol', updatedAt: 500 })];

    const out = mergeUsersLWW(current, incoming, NOW);
    expect(out.find(u => u.id === 'carol')!.name).toBe('Carol');
  });

  it('justo en el borde de la tolerancia: now + TOLERANCIA no es futuro, gana', () => {
    const current = [user({ name: 'Carol', updatedAt: 1_000 })];
    const enElBorde = NOW + TOLERANCIA_RELOJ_MS;
    const out = mergeUsersLWW(current, [user({ name: 'Carol B', updatedAt: enElBorde })], NOW);
    expect(out.find(u => u.id === 'carol')!.name).toBe('Carol B');
  });

  it('un tick pasado el borde de la tolerancia SÍ es futuro, no gana', () => {
    const current = [user({ name: 'Carol', updatedAt: 1_000 })];
    const pasadoElBorde = NOW + TOLERANCIA_RELOJ_MS + 1;
    const out = mergeUsersLWW(current, [user({ name: 'Carol B', updatedAt: pasadoElBorde })], NOW);
    expect(out.find(u => u.id === 'carol')!.name).toBe('Carol');
  });

  it('lista vacía de entrantes: no cambia nada', () => {
    const current = [user({ updatedAt: 1_000 })];
    expect(mergeUsersLWW(current, [], NOW)).toEqual(current);
  });
});
