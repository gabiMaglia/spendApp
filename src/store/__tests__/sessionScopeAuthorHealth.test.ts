import { rehydrateForActiveUser } from '../session';
import { observeAuthor, authorStats, unverifiedAuthors, clearAuthorObservations } from '@/src/sync/authorHealth';
import { useAuthStore } from '../authStore';
import type { User } from '@/src/types/models';

/**
 * T-055 · la medición de ADR-004 fase B también está scopeada por cuenta.
 *
 * Mismo agujero que tenían las cachés de T-041 y que se cerró en S6: el scope
 * de disco lo resuelve `readScoped`/`writeScoped`, pero los contadores y las
 * sospechas viven en variables de módulo con lectura perezosa. Quien entra con
 * otra cuenta **en el mismo arranque** seguía viendo lo de la anterior — y al
 * guardar lo escribía bajo el scope de la nueva.
 *
 * A `authorHealth` no lo cerró aquella revisión porque es de ADR-004, no de
 * T-041. Lo encontró el guard ampliado de `accountCoverage.test.ts`, que es
 * para lo que existe.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  startRelay: jest.fn(() => () => {}), schedulePublish: jest.fn(), deviceId: () => 'dev',
}));
// Sin directorio, `observeAuthor` cuenta `sin_directorio`: alcanza para tener
// una medición no vacía, que es lo único que este test necesita mover.
jest.mock('@/src/sync/deviceKeys', () => ({
  fetchAccountKeys: jest.fn(async () => []),
  verifyMyKeyRegistered: jest.fn(async () => true),
}));

const sesion = (id: string) => useAuthStore.setState({ currentUser: { id } as User });

beforeEach(() => {
  sesion('cuenta-a');
  clearAuthorObservations();
});

it('rehidratar con otra cuenta suelta la medición de la fase B', async () => {
  await observeAuthor('g1', 'ana', 'clave-x');
  expect(authorStats().sin_directorio).toBe(1);

  sesion('cuenta-b');
  rehydrateForActiveUser();

  expect(authorStats().sin_directorio).toBe(0);
  expect(unverifiedAuthors()).toEqual([]);
});

it('y al volver a la primera cuenta, lo suyo sigue estando', async () => {
  await observeAuthor('g1', 'ana', 'clave-x');

  sesion('cuenta-b');
  rehydrateForActiveUser();
  sesion('cuenta-a');
  rehydrateForActiveUser();

  // Se persiste a propósito: una medición que se resetea en cada arranque vive
  // siempre cerca de cero, que es la lectura equivocada que hay que evitar.
  expect(authorStats().sin_directorio).toBe(1);
});

it('soltar no puede BORRAR la medición de la cuenta que entra', async () => {
  // Si `reloadAuthorHealth` escribiera (como hace `clearAuthorObservations`),
  // cada cambio de cuenta vaciaría el scope destino y la medición nunca
  // acumularía nada.
  await observeAuthor('g1', 'ana', 'clave-x');
  sesion('cuenta-b');
  rehydrateForActiveUser();
  await observeAuthor('g2', 'beto', 'clave-y');
  expect(authorStats().sin_directorio).toBe(1);

  sesion('cuenta-a');
  rehydrateForActiveUser();
  expect(authorStats().sin_directorio).toBe(1);
});
