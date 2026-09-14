import { mergeUsersLWW } from '../mergeUsersLWW';
import { incomingWins } from '../lww';
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

/**
 * **D1 (verificador ciego, ronda 2) — el LWW normal (ninguno de los dos es
 * futuro) copiado adentro de `mergeUsersLWW` no tenía test propio.**
 *
 * Antes de T-137, `userStore` llamaba a `mergeByIdLWW` (`lww.ts`), que SÍ está
 * cubierto por `lww.test.ts`. Al meter el tope de reloj hubo que reimplementar
 * el loop acá adentro — y esa copia se quedó sin la misma red: la mutación
 * `if (curEsFuturo || incomingWins(inc, cur))` → `if (true)` (todo entrante NO
 * futuro pisa siempre, sin importar si es más viejo o pierde el empate) dejaba
 * pasar la suite COMPLETA. Estos tests exigen exactamente lo que esa mutación
 * rompe.
 */
describe('mergeUsersLWW — el LWW normal (sin futuros de por medio) sigue igual que lww.ts', () => {
  it('un entrante MÁS VIEJO y no futuro no pisa a un local MÁS NUEVO y no futuro', () => {
    const current = [user({ name: 'Carol', updatedAt: 5_000 })];
    const incoming = [user({ name: 'Vieja', updatedAt: 1_000 })];

    const out = mergeUsersLWW(current, incoming, NOW);
    expect(out.find(u => u.id === 'carol')!.name).toBe('Carol');
  });

  it('empate de updatedAt, el entrante gana el desempate por contenido: se aplica', () => {
    // 'ZZZ' > 'AAA' canónicamente (mismo criterio que incomingWins/lww.ts).
    const current = [user({ name: 'AAA', updatedAt: 5_000 })];
    const incoming = [user({ name: 'ZZZ', updatedAt: 5_000 })];
    expect(incomingWins(incoming[0]!, current[0]!)).toBe(true); // fija la premisa del test

    const out = mergeUsersLWW(current, incoming, NOW);
    expect(out.find(u => u.id === 'carol')!.name).toBe('ZZZ');
  });

  it('empate de updatedAt, el entrante PIERDE el desempate por contenido: NO se aplica', () => {
    const current = [user({ name: 'ZZZ', updatedAt: 5_000 })];
    const incoming = [user({ name: 'AAA', updatedAt: 5_000 })];
    expect(incomingWins(incoming[0]!, current[0]!)).toBe(false); // fija la premisa del test

    const out = mergeUsersLWW(current, incoming, NOW);
    expect(out.find(u => u.id === 'carol')!.name).toBe('ZZZ');
  });
});

/**
 * **D2 (verificador ciego, ronda 2) — un `updatedAt` no numérico esquiva el
 * tope y reproduce la vandalización PERMANENTE.**
 *
 * `inc.updatedAt > limiteFuturo` con `"zzz"` da `false` (una comparación con
 * un string no numérico nunca es `>`), así que pasa el tope como si fuera
 * plausible. Peor: en `incomingWins`, `real.updatedAt > "zzz"` TAMBIÉN da
 * `false` (JS no convierte `"zzz"` a `NaN` para el operador `>` de forma que
 * favorezca al numérico — la comparación entera es `false`), así que el
 * perfil real **nunca vuelve a ganar**. Es la misma permanencia que motivó
 * T-137 para `9e15`, por una puerta distinta: el delta del relay se castea
 * sin validar tipos (`src/sync/relaySync.ts:193`, `JSON.parse(...) as
 * SyncDelta`), y `acotarDeltaAlGrupo.ts` sólo filtra por id, no por forma.
 *
 * El fix es `Number.isFinite`: cubre `"zzz"`, `NaN`, `Infinity`, `null` y
 * `undefined` de una sola vez, sin lista de casos especiales.
 */
describe('mergeUsersLWW — un updatedAt no numérico tampoco gana (D2, verificador ronda 2)', () => {
  const conUpdatedAt = (raw: unknown): User => ({ ...user(), updatedAt: raw as number });

  it.each([
    ['string no numérico', 'zzz'],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['null', null],
    ['undefined', undefined],
  ])('un entrante NUEVO con updatedAt %s no se agrega', (_desc, raw) => {
    const out = mergeUsersLWW([], [conUpdatedAt(raw)], NOW);
    expect(out.find(u => u.id === 'carol')).toBeUndefined();
  });

  it.each([
    ['string no numérico', 'zzz'],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['null', null],
    ['undefined', undefined],
  ])('un entrante con updatedAt %s no reemplaza a un local válido', (_desc, raw) => {
    const current = [user({ name: 'Carol', updatedAt: 1_000 })];
    const out = mergeUsersLWW(current, [conUpdatedAt(raw)], NOW);
    expect(out.find(u => u.id === 'carol')!.name).toBe('Carol');
  });

  it('un LOCAL con updatedAt no numérico cuenta como envenenado: pierde contra cualquier entrante plausible', () => {
    // Sin el fix, `incomingWins(real, cur='zzz')` da `500 > 'zzz'` → `false`
    // por coerción a NaN: el local "gana" aunque sea basura. Nombres
    // distintos para que el assert sea real, no un empate accidental.
    const current = [{ ...conUpdatedAt('zzz'), name: 'Vandalizada' }];
    const incoming = [user({ name: 'Carol', updatedAt: 500 })];

    const out = mergeUsersLWW(current, incoming, NOW);
    expect(out.find(u => u.id === 'carol')!.name).toBe('Carol');
  });

  it('el ataque completo (D2): id NUEVO con updatedAt "zzz" primero, DESPUÉS el updatedAt real → el real gana', () => {
    // Paso 1: carol no existe todavía. El primer sobre malicioso es "id
    // nuevo" — el camino que el verificador señaló como el que de verdad
    // se cuela ("se agrega si el id es nuevo").
    const tras_ataque = mergeUsersLWW([], [{ ...conUpdatedAt('zzz'), name: 'Vandalizada' }], NOW);
    expect(tras_ataque.find(u => u.id === 'carol')).toBeUndefined();

    // Paso 2: sin el fix, si "zzz" se hubiera colado como local, el real
    // nunca le gana (`real > "zzz"` es `false` por coerción). Con el fix,
    // el ataque nunca entró en el paso 1, así que acá simplemente se agrega
    // limpio.
    const tras_real = mergeUsersLWW(tras_ataque, [user({ name: 'Carol Real', updatedAt: NOW + 1_000 })], NOW + 2_000);
    expect(tras_real.find(u => u.id === 'carol')!.name).toBe('Carol Real');
  });
});
