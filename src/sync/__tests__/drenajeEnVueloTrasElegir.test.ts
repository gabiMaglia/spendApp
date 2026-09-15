/**
 * T-136 · D-1 (verificador ciego). **Un drenaje en vuelo no deshace la elección.**
 *
 * `drainNow` captura la clave del grupo al entrar y espera la red. Si en ese
 * `await` el usuario elige otra clave (`elegirClaveDeGrupo`: purga → marca de
 * pendiente → adopta), el lote que vuelve es del topic VIEJO, sellado con la
 * clave en disputa. Antes del arreglo ese lote se aplicaba sobre el grupo
 * recién purgado y además limpiaba la marca de pendiente, así que el estado
 * del atacante terminaba publicado con la clave real.
 *
 * Acá el drenaje propio de la elección falla (sin red) a propósito: es el caso
 * en que la marca es lo único que frena la publicación.
 */
import { drainNow, readCursor } from '../relayEngine';
import { sealEnvelope, generateGroupKey, fromHex, deriveTopic } from '../envelopeCrypto';
import { signEnvelope } from '../envelopeSign';
import { estaPendienteDeDrenaje } from '../pendingDrain';
import { registrarOferta, marcarAdoptada } from '../groupKeyOffers';
import { elegirClaveDeGrupo } from '@/src/services/elegirClaveDeGrupo';
import { ensureIdentity } from '@/src/store/identityStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useAuthStore } from '@/src/store/authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import * as relay from '../relay';
import type { User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relay', () => ({
  ...jest.requireActual('@/src/sync/relay'),
  fetchSince: jest.fn(),
  sendEnvelope: jest.fn(async () => ({ ok: true, seq: 1 })),
}));
jest.mock('@/src/sync/authorHealth', () => ({ observeAuthor: jest.fn() }));
jest.mock('@/src/sync/authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));

const toHex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
const YO = { id: 'ana', name: 'Ana' } as User;

type FetchResult = Awaited<ReturnType<typeof relay.fetchSince>>;

beforeEach(() => {
  for (const b of ['groups', 'expenses', 'payments', 'recurring', 'comments', 'groupkeys'] as const) {
    createSecureStorage(b).clearAll();
  }
  jest.clearAllMocks();
  useAuthStore.setState({ currentUser: YO });
  useGroupStore.setState({ groups: [] });
  useExpenseStore.setState({ expenses: [] });
  useGroupKeyStore.setState({ keys: [] });
});

it('un drenaje del topic viejo que vuelve después de elegir no aplica nada ni limpia la marca', async () => {
  const FALSA = toHex(generateGroupKey());
  const REAL = toHex(generateGroupKey());
  useGroupKeyStore.getState().adoptKeys([{ groupId: 'g1', key: FALSA, epoch: 1e9 }]);
  registrarOferta({ groupId: 'g1', fromUserId: 'u-mallory', key: FALSA, epoch: 1e9, origen: 'contact', receivedAt: 0, adoptada: false });
  marcarAdoptada('g1', 'u-mallory');
  registrarOferta({ groupId: 'g1', fromUserId: 'u-beto', key: REAL, epoch: 3, origen: 'contact', receivedAt: 0, adoptada: false });

  // Lo que el atacante tiene en el topic viejo, sellado con la clave falsa.
  const delta = {
    version: 1 as const, featureVersion: 99, fromUserId: 'u-mallory', timestamp: Date.now(),
    groups: [{
      id: 'g1', name: 'Viaje', memberIds: ['ana', 'u-mallory'], currency: 'ARS', createdAt: 0,
      createdById: 'u-mallory', deletionVotes: [], updatedAt: Date.now(), isDeleted: false,
    }],
    expenses: [{
      id: 'e-atacante', groupId: 'g1', description: 'inyectado', amount: 100, currency: 'ARS',
      paidById: 'ana', splitMode: 'equal', splits: [], category: 'other', date: 0,
      createdAt: Date.now(), createdById: 'u-mallory', deletionVotes: [], updatedAt: Date.now(), isDeleted: false,
    }],
    payments: [], users: [], recurring: [], comments: [],
  };
  const payload = signEnvelope(sealEnvelope(fromHex(FALSA), JSON.stringify(delta)), ensureIdentity().privateKey);

  let resolverViejo!: (r: FetchResult) => void;
  (relay.fetchSince as jest.Mock)
    .mockImplementationOnce(() => new Promise<FetchResult>(res => { resolverViejo = res; }))
    // El drenaje que lanza la elección: sin red.
    .mockResolvedValue({ ok: false, reason: 'network' });

  const enVuelo = drainNow('g1');
  // Deja que el drenaje viejo llegue al `await fetchSince`.
  for (let i = 0; i < 5 && !resolverViejo; i++) await new Promise(r => setImmediate(r));
  expect(resolverViejo).toBeDefined();

  expect(await elegirClaveDeGrupo('g1', 'u-beto')).toBe(true);
  expect(useGroupKeyStore.getState().getKey('g1')).toEqual({ groupId: 'g1', key: REAL, epoch: 3 });
  expect(estaPendienteDeDrenaje('g1')).toBe(true);

  resolverViejo({ ok: true, envelopes: [{ seq: 7, payload }], cursor: 7 } as FetchResult);
  expect(await enVuelo).toBe(0);

  expect(useExpenseStore.getState().expenses.map(e => e.id)).not.toContain('e-atacante');
  expect(useGroupStore.getState().groups.map(g => g.id)).not.toContain('g1');
  expect(estaPendienteDeDrenaje('g1')).toBe(true);
  expect(readCursor(await deriveTopic(fromHex(FALSA), 1e9))).toBe(0);
});
