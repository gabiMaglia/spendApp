/**
 * Regresión de S3-A1 (`qa/SEC3-2026-09-14.md` §2).
 *
 * `drainGroup` aplicaba CRUDO lo que llegaba por el topic de un grupo con
 * `applyDelta` — la misma función del pairing QR, pensada para un canal
 * autenticado por presencia física. Un co-miembro del grupo A (con la clave de
 * A, nada más) podía sellar un sobre válido para A que además trajera:
 *
 *  - `groupKeys` con una clave propia para el grupo B de la víctima, con época
 *    absurda → sustituye la clave real de B (lectura + partición persistente);
 *  - `personal` → inyecta movimientos en el libro personal de la víctima, que
 *    NUNCA debería poder llegar por ningún canal de red;
 *  - un gasto con `groupId: ''` → entra a la pestaña Personal (T-116 exime
 *    `groupId === ''` del chequeo de membresía).
 *
 * Esta PoC es la reproducción de la auditoría, basada en
 * `scratchpad/poc/sec3RelayScope.test.ts`, con aserciones en vez de logs.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));
jest.mock('@/src/sync/relay', () => ({
  ...jest.requireActual('@/src/sync/relay'),
  fetchSince: jest.fn(),
  sendEnvelope: jest.fn(async () => ({ ok: true, seq: 1 })),
}));
jest.mock('@/src/sync/authorHealth', () => ({ observeAuthor: jest.fn() }));
jest.mock('@/src/sync/authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));

import { drainGroup } from '../relaySync';
import { sealEnvelope, generateGroupKey, fromHex } from '../envelopeCrypto';
import { signEnvelope } from '../envelopeSign';
import { ensureIdentity } from '@/src/store/identityStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useAuthStore } from '@/src/store/authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import * as relay from '../relay';
import type { User } from '@/src/types/models';

const toHex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
const VICTIM = 'victim';

describe('S3-A1 — drainGroup no adopta claves ajenas ni inyecta personal/registros cruzados', () => {
  beforeEach(() => {
    createSecureStorage('groupkeys').clearAll();
    useAuthStore.setState({ currentUser: { id: VICTIM } as User });
    useGroupKeyStore.setState({ keys: [] });
    usePersonalStore.setState({ entries: [] });
    useExpenseStore.setState({ expenses: [] });
    jest.clearAllMocks();
  });

  it('un sobre sellado con la clave de A no sustituye la clave de B ni inyecta personal/gastos ajenos', async () => {
    useGroupKeyStore.getState().adoptKeys([
      { groupId: 'A', key: toHex(generateGroupKey()), epoch: 1 },
      { groupId: 'B', key: toHex(generateGroupKey()), epoch: 1 },
    ]);
    const keyA = useGroupKeyStore.getState().getKey('A')!;
    const keyBAntes = useGroupKeyStore.getState().getKey('B')!.key;
    const attackerKeyB = toHex(generateGroupKey());

    const delta = {
      version: 1 as const, featureVersion: 99, fromUserId: 'mallory', timestamp: Date.now(),
      groups: [], payments: [], users: [], recurring: [], comments: [],
      expenses: [{
        id: 'x1', groupId: '', description: 'inyectado', amount: 100, currency: 'USD',
        paidById: VICTIM, createdById: 'mallory', splits: [], updatedAt: Date.now(),
        createdAt: Date.now(), isDeleted: false,
      }],
      personal: [{
        id: 'p1', type: 'expense', amount: 999, currency: 'USD', description: 'inyectado',
        date: Date.now(), updatedAt: Date.now(), createdAt: Date.now(), isDeleted: false,
      }],
      groupKeys: [{ groupId: 'B', key: attackerKeyB, epoch: 1e9 }],
    } as any;

    const sealed = sealEnvelope(fromHex(keyA.key), JSON.stringify(delta));
    const payload = signEnvelope(sealed, ensureIdentity().privateKey);
    (relay.fetchSince as jest.Mock).mockResolvedValue({ ok: true, envelopes: [{ seq: 1, payload }], cursor: 1 });

    const r = await drainGroup('A', VICTIM, 'dev1', 0);

    expect(r).toMatchObject({ ok: true, applied: 1 });

    // La clave de B queda intacta: NO se sustituye desde el relay.
    expect(useGroupKeyStore.getState().getKey('B')!.key).toBe(keyBAntes);
    expect(useGroupKeyStore.getState().getKey('B')!.epoch).toBe(1);

    // Nada entra al libro personal por ningún canal de red.
    expect(usePersonalStore.getState().entries).toEqual([]);

    // El gasto con groupId '' (el que se cuela a la pestaña Personal vía T-116)
    // no se aplica.
    expect(useExpenseStore.getState().expenses.find(e => e.id === 'x1')).toBeUndefined();
  });
});
