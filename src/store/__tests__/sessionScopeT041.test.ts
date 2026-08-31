import { ed25519 } from '@noble/curves/ed25519.js';
import { rehydrateForActiveUser } from '../session';
import { observeRecord, recordStats, clearRecordHealth } from '@/src/sync/recordHealth';
import { authorRatchet, clearRatchet } from '@/src/sync/ratchet';
import { verdictCacheSize, clearVerdictCache } from '@/src/sync/verdictCache';
import { knownAuthorKeys, rememberAuthorKey, forgetAuthorKeys } from '@/src/sync/authorKeys';
import { signCore } from '@/src/sync/recordSign';
import { toHex } from '@/src/sync/hexBytes';
import { EXPENSE } from '@/src/test-utils/recordFixtures';
import { useAuthStore } from '../authStore';
import type { User } from '@/src/types/models';

/**
 * **La medición de T-041 está scopeada por cuenta — también en caliente.**
 *
 * El scope de disco lo resuelve `readScoped`/`writeScoped`, pero las cachés y
 * los contadores viven en variables de módulo con lectura perezosa: quien entra
 * con otra cuenta **en el mismo arranque** seguiría viendo lo de la anterior, y
 * al guardar lo escribiría bajo el scope de la nueva. El punto donde se sueltan
 * es `rehydrateForActiveUser`, que es el que ya rehidrata todo lo demás por
 * cuenta.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  startRelay: jest.fn(() => () => {}), schedulePublish: jest.fn(), deviceId: () => 'dev',
}));

const priv = new Uint8Array(32).fill(51);
const PRIV = toHex(priv);
const PUB = toHex(ed25519.getPublicKey(priv));

const sesion = (id: string) => useAuthStore.setState({ currentUser: { id } as User });

beforeEach(() => {
  sesion('cuenta-a');
  clearRecordHealth();
  clearRatchet();
  clearVerdictCache();
  forgetAuthorKeys();
});

it('rehidratar con otra cuenta suelta la medición, el trinquete y las dos cachés', () => {
  const nucleo = { ...EXPENSE, createdById: 'ana' };
  const firmado = { ...nucleo, ...signCore('expense', nucleo as never, PRIV) };

  rememberAuthorKey('ana', PUB);
  expect(observeRecord('expense', firmado as never)).toBe('valida');

  expect(recordStats().valida).toBe(1);
  expect(authorRatchet('ana')).toBe('firma');
  expect(verdictCacheSize()).toBe(1);
  expect(knownAuthorKeys('ana')).toEqual([PUB]);

  sesion('cuenta-b');
  rehydrateForActiveUser();

  expect(recordStats().valida).toBe(0);
  expect(authorRatchet('ana')).toBe('desconocido');
  expect(verdictCacheSize()).toBe(0);
  expect(knownAuthorKeys('ana')).toEqual([]);
});

it('y al volver a la primera cuenta, lo suyo sigue estando', () => {
  const nucleo = { ...EXPENSE, createdById: 'ana' };
  const firmado = { ...nucleo, ...signCore('expense', nucleo as never, PRIV) };

  rememberAuthorKey('ana', PUB);
  observeRecord('expense', firmado as never);

  sesion('cuenta-b');
  rehydrateForActiveUser();
  sesion('cuenta-a');
  rehydrateForActiveUser();

  expect(recordStats().valida).toBe(1);
  expect(authorRatchet('ana')).toBe('firma');
  expect(knownAuthorKeys('ana')).toEqual([PUB]);
});
