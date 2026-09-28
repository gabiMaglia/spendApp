/**
 * T-146 (TEC-02): la marca de «pendiente de drenaje» (T-089) sólo se limpia
 * cuando el buzón se leyó hasta el final. Un drenaje que aplicó algo pero
 * dejó páginas (o una rebanada fallida) por delante NO habilita a publicar:
 * publicar con estado incompleto es exactamente la resurrección que T-089
 * cierra.
 */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('../relaySync', () => ({
  drainGroup: jest.fn(),
  sigueSiendoLaClave: jest.fn(() => true),
  publishToGroup: jest.fn(async () => ({ ok: true, seq: 1 })),
}));

import { drainNow, readCursor } from '../relayEngine';
import { drainGroup } from '../relaySync';
import { marcarPendienteDeDrenaje, estaPendienteDeDrenaje, limpiarPendienteDeDrenaje } from '../pendingDrain';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { deriveTopic } from '@/src/sync/nucleo/envelopeCrypto';
import { fromHex } from '@/src/sync/nucleo/hexBytes';
import type { User } from '@/src/types/models';

const drainGroupMock = drainGroup as jest.Mock;

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: 'u1' } as User });
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
  limpiarPendienteDeDrenaje('G');
  marcarPendienteDeDrenaje('G');
  drainGroupMock.mockReset();
});

it('con completo:true limpia la marca y persiste el cursor', async () => {
  drainGroupMock.mockResolvedValue({ ok: true, applied: 3, skipped: 0, cursor: 9, completo: true });
  await drainNow('G');
  expect(estaPendienteDeDrenaje('G')).toBe(false);
  const rec = useGroupKeyStore.getState().getKey('G')!;
  expect(readCursor(await deriveTopic(fromHex(rec.key), rec.epoch))).toBe(9);
});

it('con completo:false persiste el cursor pero NO limpia la marca', async () => {
  drainGroupMock.mockResolvedValue({ ok: true, applied: 3, skipped: 0, cursor: 4, completo: false });
  await drainNow('G');
  expect(estaPendienteDeDrenaje('G')).toBe(true);
  const rec = useGroupKeyStore.getState().getKey('G')!;
  expect(readCursor(await deriveTopic(fromHex(rec.key), rec.epoch))).toBe(4);
});

it('un drenaje fallido no toca ni cursor ni marca (como antes)', async () => {
  drainGroupMock.mockResolvedValue({ ok: false, reason: 'network' });
  await drainNow('G');
  expect(estaPendienteDeDrenaje('G')).toBe(true);
});
