import { useUserStore } from '../userStore';
import { applyDelta, type SyncDelta } from '@/src/sync/useSyncQR';
import { applyBackup } from '@/src/services/backup';
import type { User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

/**
 * **T-137 (ADR-012) — el tope de `updatedAt` futuro llega por los TRES caminos**
 * que pasan por `mergeUsers`: relay y QR comparten `applyDelta`
 * (`src/sync/useSyncQR.ts:145`), y backup llama `mergeUsers` directo
 * (`src/services/backup.ts:119`). Ninguno de los tres pasa `now`
 * explícitamente, así que los tres dependen del default `syncedNow()` fijado
 * en el store — este test los prueba end-to-end, no la función pura.
 */
const carol = (over: Partial<User> = {}): User => ({
  id: 'carol', name: 'Carol', email: 'carol@x.com', authProvider: 'google',
  createdAt: 0, updatedAt: 1_000, isDeleted: false, ...over,
});

beforeEach(() => {
  useUserStore.setState({ users: [carol()] });
});

describe('mergeUsers — con `now` inyectado explícito', () => {
  it('D3 regresión: 9e15 primero, después el updatedAt real → gana el real', () => {
    const now = Date.now();

    useUserStore.getState().mergeUsers([carol({ name: 'Vandalizada', updatedAt: 9e15 })], now);
    expect(useUserStore.getState().getUserName('carol')).toBe('Carol');

    useUserStore.getState().mergeUsers([carol({ name: 'Carol Real', updatedAt: now + 1_000 })], now + 2_000);
    expect(useUserStore.getState().getUserName('carol')).toBe('Carol Real');
  });
});

describe('mergeUsers — default `now` (sin pasarlo, como llaman los 3 caminos reales)', () => {
  it('un updatedAt absurdamente futuro no gana ni siquiera con el default', () => {
    useUserStore.getState().mergeUsers([carol({ name: 'Vandalizada', updatedAt: 9e15 })]);
    expect(useUserStore.getState().getUserName('carol')).toBe('Carol');
  });

  it('camino QR/relay compartido: applyDelta no deja pasar un perfil del futuro', () => {
    const delta: SyncDelta = {
      version: 1, fromUserId: 'beto', timestamp: 0,
      groups: [], expenses: [], payments: [],
      users: [carol({ name: 'Vandalizada por QR', updatedAt: 9e15 })],
    };
    applyDelta(delta, 'yo');
    expect(useUserStore.getState().getUserName('carol')).toBe('Carol');
  });

  it('camino backup: restaurar un backup con updatedAt futuro no lo adopta', () => {
    // `applyBackup` REEMPLAZA (vacía el store y mergea sobre `[]`, ver
    // `backup.ts:102-107`), así que acá no hay local previo con quien competir:
    // el caso es "id nuevo con updatedAt futuro", que el criterio 1 tampoco deja
    // agregar — el backup queda SIN carol, no con la vandalizada.
    applyBackup({
      version: 1,
      groups: [], expenses: [], payments: [], recurring: [], comments: [],
      users: [carol({ name: 'Vandalizada por backup', updatedAt: 9e15 })],
      personalEntries: [], personalBudget: {},
    } as never);
    expect(useUserStore.getState().getUserById('carol')).toBeUndefined();
  });
});
