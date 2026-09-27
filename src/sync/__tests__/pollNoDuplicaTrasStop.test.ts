/**
 * Verifier ciego (rechazo de perf/ola-b), B1: la cadena de poll (T-158a,
 * `programarProximoPoll`) sobrevivía a `stopPolling` y podía duplicarse.
 *
 * `programarProximoPoll` reprogramaba SIEMPRE en el `.finally` de
 * `releerTodo()`, sin mirar si el motor se había detenido o reiniciado
 * mientras esa vuelta seguía en vuelo (p. ej. `ensureRelaySession` colgada).
 * Reproducido por el verificador: `stopRelay()` durante un poll en vuelo
 * dejaba 5 polls en 100s DESPUÉS del stop; `startRelay()` en ese mismo
 * momento producía DOS cadenas (6 polls en 3 intervalos en vez de 3).
 *
 * El arreglo es un token de generación: `startPolling`/`stopPolling` lo
 * incrementan, y cada vuelta de la cadena sólo se reprograma si la
 * generación que capturó al agendarse sigue siendo la vigente.
 */
jest.mock('../relaySession', () => ({
  ensureRelaySession: jest.fn(async () => 'anonymous'),
  bindAuthRefreshToAppState: jest.fn(() => jest.fn()),
  haySesionEnCurso: jest.fn(() => false),
}));

jest.mock('../relay', () => ({
  isRelayConfigured: () => true,
  subscribeTopic: jest.fn(() => () => {}),
  sendEnvelope: jest.fn(async () => ({ ok: true, seq: 1 })),
  fetchSince: jest.fn(async () => ({ ok: true, envelopes: [], cursor: 0, more: false })),
  deleteMyEnvelopes: jest.fn(async () => ({ ok: true, deleted: 0 })),
  getRelayClient: () => null,
  esFuncionAusente: () => false,
}));

jest.mock('../inviteEngine', () => ({
  activeInvites: () => [],
  processInvite: jest.fn(async () => [] as string[]),
  processAllInvites: jest.fn(async () => [] as string[]),
}));
jest.mock('../contactChannel', () => ({
  ensureContactSecret: () => null,
  deriveContactTopic: jest.fn(async () => 'topic-contactos'),
  drainContacts: jest.fn(async () => ({ cursor: 0, added: 0, joinedGroups: [], conflictedGroups: [] })),
  sendGroupKeyResultado: jest.fn(async () => ({ ok: true, seq: 1 })),
  announceContact: jest.fn(async () => true),
  listPeers: () => ({}),
  myContactCard: () => null,
  cardFingerprint: () => '',
  cardYaEnviada: () => false,
  marcarCardEnviada: () => {},
}));
jest.mock('../contactInviteEngine', () => ({ processAllContactInvites: jest.fn(async () => false) }));

import { startRelay, stopRelay, POLL_CAIDO_MS, POLL_OK_MS, __resetReenvioClaves } from '../relayEngine';
import { __resetRelayQueue } from '../relayQueue';
import { __resetSessionStatus } from '../sessionStatus';
import { clearPublishFailures } from '../publishHealth';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Group, User } from '@/src/types/models';

const mockEnsureRelaySession = jest.requireMock('../relaySession').ensureRelaySession as jest.Mock;
const mockBindAuthRefreshToAppState = jest.requireMock('../relaySession').bindAuthRefreshToAppState as jest.Mock;

function sembrarUnGrupoConClave(): void {
  useAuthStore.setState({ currentUser: { id: 'u1' } as User });
  useGroupStore.setState({
    groups: [{
      id: 'G', name: 'Grupo', memberIds: ['u1'], currency: 'USD', createdAt: 0, createdById: 'u1',
      deletionVotes: [], updatedAt: 1_000, isDeleted: false,
    } as Group],
    isLoading: false,
  });
  useGroupKeyStore.getState().ensureKey('G');
}

beforeEach(() => {
  jest.useFakeTimers();
  createSecureStorage('groupkeys').clearAll();
  useAuthStore.setState({ currentUser: null });
  useGroupStore.setState({ groups: [], isLoading: false });
  useGroupKeyStore.setState({ keys: [] });
  mockEnsureRelaySession.mockReset().mockResolvedValue('anonymous');
  mockBindAuthRefreshToAppState.mockReset().mockReturnValue(jest.fn());
  clearPublishFailures();
  __resetSessionStatus();
  __resetReenvioClaves();
  __resetRelayQueue();
});

afterEach(() => {
  stopRelay();
  jest.useRealTimers();
});

it('B1: stopRelay durante un poll colgado no deja una cadena viva después del stop', async () => {
  sembrarUnGrupoConClave();
  await startRelay();

  // El próximo poll (conservador, 20s: todavía no hay estado de canales)
  // queda colgado en `ensureRelaySession` — simula el `getSession()` lento
  // que reprodujo el verificador.
  let resolverHang!: (v: string) => void;
  mockEnsureRelaySession.mockImplementation(() => new Promise<string>(res => { resolverHang = res; }));

  await jest.advanceTimersByTimeAsync(POLL_CAIDO_MS);
  expect(resolverHang).toBeDefined(); // el poll entró y quedó colgado

  stopRelay();

  // Recién ACÁ se libera la sesión colgada — DESPUÉS del stop, que es
  // justo el caso que dejaba la cadena viva.
  resolverHang('anonymous');
  await Promise.resolve();
  await Promise.resolve();

  const n = mockEnsureRelaySession.mock.calls.length;
  mockEnsureRelaySession.mockResolvedValue('anonymous');

  // Mucho tiempo después del stop: si la cadena sobrevivió, esto dispara
  // varias vueltas más. No debería disparar ninguna.
  await jest.advanceTimersByTimeAsync(POLL_OK_MS * 5);

  expect(mockEnsureRelaySession.mock.calls.length).toBe(n);
});

it('B1: startRelay durante un poll colgado deja UNA sola cadena viva, no dos', async () => {
  sembrarUnGrupoConClave();
  await startRelay();

  let resolverHang!: (v: string) => void;
  mockEnsureRelaySession.mockImplementation(() => new Promise<string>(res => { resolverHang = res; }));

  await jest.advanceTimersByTimeAsync(POLL_CAIDO_MS);
  expect(resolverHang).toBeDefined(); // el poll viejo entró y quedó colgado

  // Se reinicia el motor MIENTRAS el poll anterior sigue colgado (p. ej. un
  // cambio de sesión detectado por otra vía).
  mockEnsureRelaySession.mockImplementation(async () => 'anonymous');
  await startRelay();

  // Recién ahora se libera el poll VIEJO, que quedó colgado desde antes
  // del reinicio.
  resolverHang('anonymous');
  await Promise.resolve();
  await Promise.resolve();

  mockEnsureRelaySession.mockClear();
  mockEnsureRelaySession.mockImplementation(async () => 'anonymous');

  // 3 intervalos conservadores (20s: sin estado de canales tras el reinicio).
  await jest.advanceTimersByTimeAsync(POLL_CAIDO_MS * 3);

  // UNA sola cadena: 3 llamadas, no 6 (dos cadenas superpuestas).
  expect(mockEnsureRelaySession.mock.calls.length).toBe(3);
});
