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

import { drainGroup, buildGroupPayload } from '../relaySync';
import { sealEnvelope, generateGroupKey, fromHex } from '../envelopeCrypto';
import { signEnvelope } from '../envelopeSign';
import { ensureIdentity } from '@/src/store/identityStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupStore } from '@/src/store/groupStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { useAuthStore } from '@/src/store/authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import * as relay from '../relay';
import type { User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));
jest.mock('@/src/sync/relay', () => ({
  ...jest.requireActual('@/src/sync/relay'),
  fetchSince: jest.fn(),
  sendEnvelope: jest.fn(async () => ({ ok: true, seq: 1 })),
}));
jest.mock('@/src/sync/authorHealth', () => ({ observeAuthor: jest.fn() }));
jest.mock('@/src/sync/authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));

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

  // Regla #8 de CLAUDE.md: quien entra tarde a un grupo tiene que ver TODO el
  // historial por el relay. El recorte no puede tirar el caso legítimo junto
  // con el hostil.
  it('un miembro nuevo que drena el sobre legítimo del grupo sigue viendo todo el historial', async () => {
    // El publicador (otro dispositivo) arma su estado real de A.
    useAuthStore.setState({ currentUser: { id: 'publisher' } as User });
    useGroupStore.setState({ groups: [
      { id: 'A', name: 'Asado', memberIds: ['publisher', VICTIM], currency: 'ARS',
        createdAt: 0, createdById: 'publisher', deletionVotes: [],
        updatedAt: 1_000, isDeleted: false } as any,
    ]});
    useExpenseStore.setState({ expenses: [
      { id: 'histA', groupId: 'A', description: 'Carne', amount: 20_000, currency: 'ARS',
        paidById: 'publisher', splitMode: 'equal', splits: [], category: 'food', date: 0,
        createdAt: 0, createdById: 'publisher', deletionVotes: [],
        updatedAt: 1_000, isDeleted: false } as any,
    ]});
    usePaymentStore.setState({ payments: [] });
    useUserStore.setState({ users: [
      { id: 'publisher', name: 'Publisher' } as any,
      { id: VICTIM, name: 'Victim' } as any,
    ]});

    const payload = buildGroupPayload('A', 'publisher');
    useGroupKeyStore.getState().adoptKeys([{ groupId: 'A', key: toHex(generateGroupKey()), epoch: 1 }]);
    const keyA = useGroupKeyStore.getState().getKey('A')!;

    const sealed = sealEnvelope(fromHex(keyA.key), JSON.stringify(payload));
    const signedPayload = signEnvelope(sealed, ensureIdentity().privateKey);
    (relay.fetchSince as jest.Mock).mockResolvedValue({
      ok: true, envelopes: [{ seq: 1, payload: signedPayload }], cursor: 1,
    });

    // El nuevo miembro (VICTIM) no tiene nada local todavía.
    useGroupStore.setState({ groups: [] });
    useExpenseStore.setState({ expenses: [] });
    useAuthStore.setState({ currentUser: { id: VICTIM } as User });

    const r = await drainGroup('A', VICTIM, 'dev2', 0);

    expect(r).toMatchObject({ ok: true, applied: 1 });
    expect(useGroupStore.getState().groups.map(g => g.id)).toEqual(['A']);
    expect(useExpenseStore.getState().expenses.map(e => e.id)).toEqual(['histA']);
  });
});
