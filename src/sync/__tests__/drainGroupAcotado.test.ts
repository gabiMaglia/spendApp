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
import { useRecurringStore } from '@/src/store/recurringStore';
import { useCommentStore } from '@/src/store/commentStore';
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
    useGroupStore.setState({ groups: [] });
    usePaymentStore.setState({ payments: [] });
    useRecurringStore.setState({ recurring: [] });
    useCommentStore.setState({ comments: [] });
    useUserStore.setState({ users: [] });
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
      // `updatedAt` numérico y real: T-137 (D2) rechaza un perfil con
      // `updatedAt` no finito como si fuera basura vandalizada, y esta
      // fixture representa el estado LEGÍTIMO del publicador, no un ataque.
      { id: 'publisher', name: 'Publisher', updatedAt: 1_000 } as any,
      { id: VICTIM, name: 'Victim', updatedAt: 1_000 } as any,
    ]});

    const payload = buildGroupPayload('A', 'publisher');
    useGroupKeyStore.getState().adoptKeys([{ groupId: 'A', key: toHex(generateGroupKey()), epoch: 1 }]);
    const keyA = useGroupKeyStore.getState().getKey('A')!;

    const sealed = sealEnvelope(fromHex(keyA.key), JSON.stringify(payload));
    const signedPayload = signEnvelope(sealed, ensureIdentity().privateKey);
    (relay.fetchSince as jest.Mock).mockResolvedValue({
      ok: true, envelopes: [{ seq: 1, payload: signedPayload }], cursor: 1,
    });

    // El nuevo miembro (VICTIM) no tiene nada local todavía — ni grupo, ni
    // gasto, ni un solo perfil conocido (incluido el del propio publicador).
    useGroupStore.setState({ groups: [] });
    useExpenseStore.setState({ expenses: [] });
    useUserStore.setState({ users: [] });
    useAuthStore.setState({ currentUser: { id: VICTIM } as User });

    const r = await drainGroup('A', VICTIM, 'dev2', 0);

    expect(r).toMatchObject({ ok: true, applied: 1 });
    expect(useGroupStore.getState().groups.map(g => g.id)).toEqual(['A']);
    expect(useExpenseStore.getState().expenses.map(e => e.id)).toEqual(['histA']);
    // Con nada local que pisar, los perfiles de TODOS los miembros llegan —
    // incluido el del publicador, que la víctima nunca había visto.
    expect(useUserStore.getState().users.map(u => u.id).sort()).toEqual(['publisher']);
  });

  /**
   * Ronda 2 (`engram/qa/T-132.md`, `engram/qa/T-132-verifier.md`): el filtro
   * de ronda 1 confiaba en lo que el propio registro entrante DECLARABA
   * (`groupId`, `expenseId`, `memberIds`), pero el merge de abajo
   * (`mergeByIdLevels`/`mergeByIdLWW`) une por `id` sin verificar esos campos.
   * Reproduce, punta a punta por `drainGroup`, los tres ataques exactos del
   * veredicto: robo+borrado de un gasto de OTRO grupo declarando `groupId`
   * propio, reasignación de un comentario ajeno, y suplantación de un perfil
   * ya conocido metiéndolo en `memberIds` del mismo sobre.
   */
  it('un co-miembro de A no puede robar/borrar un gasto de B, reescribir su comentario ni suplantar un perfil metiéndolo en memberIds del mismo sobre', async () => {
    useGroupKeyStore.getState().adoptKeys([{ groupId: 'A', key: toHex(generateGroupKey()), epoch: 1 }]);
    const keyA = useGroupKeyStore.getState().getKey('A')!;

    // Estado previo de la víctima: grupo A real, gasto+comentario de OTRO
    // grupo (B), y un perfil conocido (bob) que NO es miembro local de A.
    useGroupStore.setState({ groups: [
      { id: 'A', name: 'Asado', memberIds: [VICTIM, 'mallory'], currency: 'ARS',
        createdAt: 0, createdById: VICTIM, deletionVotes: [], updatedAt: 1_000, isDeleted: false } as any,
    ]});
    useExpenseStore.setState({ expenses: [
      { id: 'eB', groupId: 'B', description: 'de B', amount: 1, currency: 'ARS',
        paidById: VICTIM, splitMode: 'equal', splits: [], category: 'food', date: 0,
        createdAt: 0, createdById: VICTIM, deletionVotes: [], updatedAt: 1_000, isDeleted: false } as any,
    ]});
    useCommentStore.setState({ comments: [
      { id: 'cB', expenseId: 'eB', authorId: VICTIM, text: 'original', createdAt: 0,
        updatedAt: 1_000, isDeleted: false } as any,
    ]});
    useUserStore.setState({ users: [{ id: 'bob', name: 'Bob real', authProvider: 'google' } as any] });

    const delta = {
      version: 1 as const, featureVersion: 2, fromUserId: 'mallory', timestamp: Date.now(),
      groups: [{ id: 'A', name: 'Asado', memberIds: [VICTIM, 'mallory', 'bob'], currency: 'ARS',
        createdAt: 0, createdById: 'mallory', deletionVotes: [], updatedAt: 999_999, isDeleted: false }],
      // (a) robar+borrar el gasto de B declarando groupId propio.
      expenses: [{
        id: 'eB', groupId: 'A', rev: 999, isDeleted: true, description: 'robado',
        amount: 1, currency: 'USD', paidById: 'mallory', splits: [], updatedAt: 999_999,
        createdAt: 0, createdById: 'mallory',
      }],
      payments: [],
      // (c) suplantar el perfil de bob, ya conocido pero no miembro local de A.
      users: [{ id: 'bob', name: 'BOB HACKEADO', email: 'evil@x' }],
      recurring: [],
      // (b) reescribir el comentario de B colgándolo de un gasto que declara ser de A.
      comments: [{ id: 'cB', expenseId: 'eB', rev: 999, text: 'HACK', authorId: 'mallory',
        createdAt: 0, updatedAt: 999_999, isDeleted: false }],
    } as any;

    const sealed = sealEnvelope(fromHex(keyA.key), JSON.stringify(delta));
    const payload = signEnvelope(sealed, ensureIdentity().privateKey);
    (relay.fetchSince as jest.Mock).mockResolvedValue({ ok: true, envelopes: [{ seq: 1, payload }], cursor: 1 });

    const r = await drainGroup('A', VICTIM, 'dev1', 0);
    expect(r).toMatchObject({ ok: true, applied: 1 });

    // (a) el gasto de B sigue siendo de B y vivo.
    const eB = useExpenseStore.getState().expenses.find(e => e.id === 'eB');
    expect(eB?.groupId).toBe('B');
    expect(eB?.isDeleted).toBe(false);

    // (b) el comentario de B no fue reescrito.
    const cB = useCommentStore.getState().comments.find(c => c.id === 'cB');
    expect(cB?.text).toBe('original');

    // (c) el perfil de bob no fue sobrescrito aunque el sobre lo metió en
    // memberIds de A en el mismo envío.
    const bob = useUserStore.getState().users.find(u => u.id === 'bob');
    expect(bob?.name).toBe('Bob real');
  });
});
