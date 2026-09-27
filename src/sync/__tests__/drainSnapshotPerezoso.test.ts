/**
 * T-158b: la "foto previa" de `drainNow` (`snapshot(...)`, la que distingue
 * "llegó recién" de "ya estaba" para los avisos de T-010) se calculaba SIEMPRE,
 * en cada drenaje — incluidos los que no traían un solo sobre nuevo (la
 * inmensa mayoría de las vueltas de poll, en un grupo tranquilo). Es trabajo
 * de JS sobre potencialmente miles de gastos, tirado a la basura la mayoría
 * de las veces.
 *
 * `drainGroup` ahora recibe `opts.antesDeAplicar`, una función que invoca UNA
 * SOLA VEZ, justo antes de aplicar la primera página que trae sobres — nunca
 * si el buzón está vacío. `drainNow` la usa para tomar la foto perezosamente:
 * si nunca se llamó (buzón vacío), no hay foto y no se calculan avisos.
 */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

jest.mock('../relaySync', () => ({
  drainGroup: jest.fn(),
  sigueSiendoLaClave: jest.fn(() => true),
  publishToGroup: jest.fn(async () => ({ ok: true, seq: 1 })),
}));

const mockSnapshot = jest.fn(() => ({
  expenseIds: [], conBorradoAbierto: [], paymentIds: [], borrados: [], traspasosConocidos: {},
}));
const mockNoticesFor = jest.fn(() => [
  { kind: 'expenses' as const, groupId: 'G', groupName: 'Grupo', count: 2 },
]);
jest.mock('@/src/services/syncNotices', () => ({
  snapshot: mockSnapshot,
  noticesFor: mockNoticesFor,
}));

const mockAnnounce = jest.fn(async () => {});
jest.mock('@/src/services/notifications', () => ({ announce: mockAnnounce }));

import { drainNow } from '../relayEngine';
import { drainGroup, type DrainOptions } from '../relaySync';
import { marcarPendienteDeDrenaje, limpiarPendienteDeDrenaje } from '../pendingDrain';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import type { User } from '@/src/types/models';

const drainGroupMock = drainGroup as unknown as jest.Mock;

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: 'u1' } as User });
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
  limpiarPendienteDeDrenaje('G');
  marcarPendienteDeDrenaje('G');
  drainGroupMock.mockReset();
  mockSnapshot.mockClear();
  mockNoticesFor.mockClear();
  mockAnnounce.mockClear();
});

it('S5: buzón sin sobres nuevos -> NO se calcula snapshot()', async () => {
  // El drenaje real nunca llama a `antesDeAplicar` cuando `fetchSince` no
  // trae nada que aplicar.
  drainGroupMock.mockImplementation(async () => ({
    ok: true, applied: 0, skipped: 0, cursor: 5, completo: true,
  }));

  await drainNow('G');

  expect(mockSnapshot).not.toHaveBeenCalled();
  expect(mockAnnounce).not.toHaveBeenCalled();
});

it('S6: buzón con sobres -> snapshot() se calcula UNA vez, antes de aplicar, y los avisos salen igual que hoy', async () => {
  const orden: string[] = [];
  drainGroupMock.mockImplementation(async (_g: string, _u: string, _d: string, _since: number, opts?: DrainOptions & { antesDeAplicar?: () => void }) => {
    orden.push('fetch');
    opts?.antesDeAplicar?.();
    orden.push('aplicar');
    return { ok: true, applied: 2, skipped: 0, cursor: 9, completo: true };
  });

  await drainNow('G');

  expect(mockSnapshot).toHaveBeenCalledTimes(1);
  expect(orden).toEqual(['fetch', 'aplicar']); // la foto se toma ANTES de aplicar, después de fetchear
  expect(mockNoticesFor).toHaveBeenCalledTimes(1);
  expect(mockAnnounce).toHaveBeenCalledWith([{ kind: 'expenses', groupId: 'G', groupName: 'Grupo', count: 2 }]);
});
