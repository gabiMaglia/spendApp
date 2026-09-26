/**
 * T-147 (D1/D5/T7) · el motor tiene que abrir sesión ANTES de suscribir
 * cualquier canal — un canal privado que se une sin JWT queda afuera en
 * silencio — y reiniciarse si la sesión cambió entre vueltas (captcha resuelto
 * tarde, login con Google mientras corría, sesión perdida).
 *
 * Los jest.fn() de los mocks van INLINE en la factory (no en un `const` de
 * afuera): un `import` normal de `relayEngine` se compila a un `require` que
 * queda ANTES de los `const` de este archivo en el orden final (jest hoistea
 * los `jest.mock` por encima de los imports, pero un `const` común no se
 * hoistea) — con la referencia afuera, el mock se ejecuta con la variable
 * todavía `undefined`. Ver `relayEngine.test.ts` para el mismo patrón.
 */
jest.mock('../relaySession', () => ({
  ensureRelaySession: jest.fn(async () => 'anonymous'),
  bindAuthRefreshToAppState: jest.fn(() => jest.fn()),
}));

jest.mock('../relay', () => ({
  isRelayConfigured: () => true,
  subscribeTopic: jest.fn(() => () => {}),
  sendEnvelope: jest.fn(async () => ({ ok: true, seq: 1 })),
  fetchSince: jest.fn(async () => ({ ok: true, envelopes: [], cursor: 0, more: false })),
  deleteMyEnvelopes: jest.fn(async () => ({ ok: true, deleted: 0 })),
  // `deviceKeys.verifyMyKeyRegistered` (llamado dentro de `arrancarCadenaDeSync`)
  // necesita estos dos: sin cliente, se resuelve como "desconocido" y sigue.
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
  sendGroupKey: jest.fn(async () => true),
  announceContact: jest.fn(async () => true),
  listPeers: () => ({}),
  myContactCard: () => null,
  cardFingerprint: () => '',
  cardYaEnviada: () => false,
  marcarCardEnviada: () => {},
}));
jest.mock('../contactInviteEngine', () => ({ processAllContactInvites: jest.fn(async () => false) }));

import { startRelay, stopRelay, POLL_INTERVAL_MS } from '../relayEngine';
import { sinSesionDeSync, __resetSessionStatus } from '../sessionStatus';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Group, User } from '@/src/types/models';

const mockEnsureRelaySession = jest.requireMock('../relaySession').ensureRelaySession as jest.Mock;
const mockBindAuthRefreshToAppState = jest.requireMock('../relaySession').bindAuthRefreshToAppState as jest.Mock;
const mockSubscribeTopic = jest.requireMock('../relay').subscribeTopic as jest.Mock;

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
  mockSubscribeTopic.mockReset().mockImplementation(() => () => {});
  __resetSessionStatus();
});

afterEach(() => {
  stopRelay();
  jest.useRealTimers();
});

it('abre la sesión ANTES de suscribir cualquier canal', async () => {
  const orden: string[] = [];
  mockEnsureRelaySession.mockImplementation(async () => { orden.push('sesion'); return 'anonymous'; });
  mockSubscribeTopic.mockImplementation(() => { orden.push('suscribe'); return () => {}; });
  sembrarUnGrupoConClave();

  await startRelay();

  expect(orden[0]).toBe('sesion');
  expect(orden).toContain('suscribe');
});

it('si la sesión cambió entre vueltas, reinicia el motor', async () => {
  sembrarUnGrupoConClave();
  mockEnsureRelaySession.mockResolvedValueOnce('none').mockResolvedValue('anonymous');

  await startRelay();
  const llamadasAntes = mockSubscribeTopic.mock.calls.length;

  await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
  await jest.advanceTimersByTimeAsync(0);

  expect(mockSubscribeTopic.mock.calls.length).toBeGreaterThan(llamadasAntes);
});

it('con la misma sesión, la vuelta NO reinicia', async () => {
  sembrarUnGrupoConClave();
  mockEnsureRelaySession.mockResolvedValue('identity');

  await startRelay();
  const n = mockSubscribeTopic.mock.calls.length;

  await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

  expect(mockSubscribeTopic.mock.calls.length).toBe(n);
});

/**
 * Enmienda del PO (aprobación 2026-09-26): sin sesión, el teléfono avisa que
 * no está sincronizando — y deja de avisar en cuanto se recupera, sin que el
 * usuario tenga que hacer nada.
 */
it('sin sesión avisa; al recuperarla, se retira', async () => {
  sembrarUnGrupoConClave();
  mockEnsureRelaySession.mockResolvedValueOnce('none').mockResolvedValue('anonymous');

  await startRelay();
  expect(sinSesionDeSync()).toBe(true);

  await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
  await jest.advanceTimersByTimeAsync(0);

  expect(sinSesionDeSync()).toBe(false);
});

/**
 * Verifier D5: `startRelay` corre AUNQUE no haya usuario activo (pantalla de
 * login, antes de elegir Google/Apple/invitado) — ahí no hay nada que
 * sincronizar todavía (`syncableGroupIds` ya exige `currentUser`), así que no
 * hay motivo para abrir sesión (ni mostrar su captcha) encima del login.
 */
it('D5: sin usuario activo, no intenta abrir ninguna sesión', async () => {
  await startRelay();
  expect(mockEnsureRelaySession).not.toHaveBeenCalled();
});

it('D5: en el poll tampoco, mientras siga sin usuario', async () => {
  await startRelay();
  mockEnsureRelaySession.mockClear();

  await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

  expect(mockEnsureRelaySession).not.toHaveBeenCalled();
});

it('ata el refresco al ciclo de vida y lo suelta al parar', async () => {
  const soltar = jest.fn();
  mockBindAuthRefreshToAppState.mockReturnValue(soltar);
  mockEnsureRelaySession.mockResolvedValue('anonymous');

  await startRelay();
  stopRelay();

  expect(mockBindAuthRefreshToAppState).toHaveBeenCalled();
  expect(soltar).toHaveBeenCalled();
});
