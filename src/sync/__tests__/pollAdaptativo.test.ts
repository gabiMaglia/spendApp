/**
 * T-158a: el poll de respaldo deja de ser un intervalo fijo de 20s y pasa a
 * depender del estado de los canales Realtime (DEC-04) — 90s cuando todos los
 * canales de grupo están `SUBSCRIBED`, 20s (el valor de siempre) apenas
 * alguno cayó (`CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`) o todavía no hay ninguno
 * suscripto (arranque, invitado sin grupos).
 *
 * Mismo patrón de mocks que `relayEngineSesion.test.ts`: `../relay` mockeado
 * entero (evita red real), `subscribeTopic` capturado para poder invocar el
 * callback de estado a mano y simular lo que el canal privado reportaría.
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

import {
  startRelay, stopRelay, POLL_OK_MS, POLL_CAIDO_MS, intervaloDePoll, __resetReenvioClaves,
} from '../relayEngine';
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
const mockSubscribeTopic = jest.requireMock('../relay').subscribeTopic as jest.Mock;

/** Callbacks de estado capturados por topic, tal cual los pasaría `startRelay`
 *  al suscribir cada grupo (`subscribeTopic(topic, onNews, onStatus)`). */
const estados = new Map<string, (ok: boolean) => void>();

function sembrarUnGrupoConClave(): void {
  useAuthStore.setState({ currentUser: { id: 'u1' } as User });
  useGroupStore.setState({
    groups: [{
      id: 'G', name: 'Grupo', memberIds: ['u1'], currency: 'USD', createdAt: 0, createdById: 'u1',
      miembros: {}, // T-182: placeholder de tipo (fixture no ejercita el roster)
      deletionVotes: [], updatedAt: 1_000, isDeleted: false,
    } as Group],
    isLoading: false,
  });
  useGroupKeyStore.getState().ensureKey('G');
}

function sembrarDosGruposConClave(): void {
  useAuthStore.setState({ currentUser: { id: 'u1' } as User });
  useGroupStore.setState({
    groups: [
      {
        id: 'G1', name: 'Grupo 1', memberIds: ['u1'], currency: 'USD', createdAt: 0, createdById: 'u1',
        miembros: {}, // T-182: placeholder de tipo (fixture no ejercita el roster)
        deletionVotes: [], updatedAt: 1_000, isDeleted: false,
      } as Group,
      {
        id: 'G2', name: 'Grupo 2', memberIds: ['u1'], currency: 'USD', createdAt: 0, createdById: 'u1',
        miembros: {}, // T-182: placeholder de tipo (fixture no ejercita el roster)
        deletionVotes: [], updatedAt: 1_000, isDeleted: false,
      } as Group,
    ],
    isLoading: false,
  });
  useGroupKeyStore.getState().ensureKey('G1');
  useGroupKeyStore.getState().ensureKey('G2');
}

beforeEach(() => {
  jest.useFakeTimers();
  createSecureStorage('groupkeys').clearAll();
  useAuthStore.setState({ currentUser: null });
  useGroupStore.setState({ groups: [], isLoading: false });
  useGroupKeyStore.setState({ keys: [] });
  estados.clear();
  mockEnsureRelaySession.mockReset().mockResolvedValue('anonymous');
  mockBindAuthRefreshToAppState.mockReset().mockReturnValue(jest.fn());
  mockSubscribeTopic.mockReset().mockImplementation(
    (topic: string, _onNews: () => void, onStatus?: (ok: boolean) => void) => {
      if (onStatus) estados.set(topic, onStatus);
      return () => { estados.delete(topic); };
    },
  );
  clearPublishFailures();
  __resetSessionStatus();
  __resetReenvioClaves();
  __resetRelayQueue();
});

afterEach(() => {
  stopRelay();
  jest.useRealTimers();
});

describe('T-158a: poll adaptativo según estado de canales Realtime (DEC-04)', () => {
  it('S1: todos los canales SUBSCRIBED -> el próximo poll es a los 90s, no antes', async () => {
    sembrarUnGrupoConClave();
    await startRelay();
    expect(estados.size).toBeGreaterThan(0); // se suscribió al menos un canal de grupo
    for (const cb of estados.values()) cb(true);

    // El primer poll ya había quedado agendado (conservador, 20s) ANTES de
    // que el status llegara — se lo deja consumir; lo que importa es el
    // SIGUIENTE, que ya se recalcula con el mapa en `true`.
    await jest.advanceTimersByTimeAsync(POLL_CAIDO_MS);
    const n = mockEnsureRelaySession.mock.calls.length;

    await jest.advanceTimersByTimeAsync(POLL_OK_MS - 1_000);
    expect(mockEnsureRelaySession.mock.calls.length).toBe(n); // todavía no

    await jest.advanceTimersByTimeAsync(1_000);
    expect(mockEnsureRelaySession.mock.calls.length).toBeGreaterThan(n); // ahora sí
  });

  it('S2: algún canal caído -> el próximo poll es a los 20s; al recuperarse todos, vuelve a 90s', async () => {
    sembrarUnGrupoConClave();
    await startRelay();
    for (const cb of estados.values()) cb(false); // CHANNEL_ERROR/TIMED_OUT/CLOSED

    // Mismo motivo que en S1: se consume el primer poll (ya agendado antes
    // del status) para medir el SIGUIENTE con el mapa ya puesto.
    await jest.advanceTimersByTimeAsync(POLL_CAIDO_MS);
    const n = mockEnsureRelaySession.mock.calls.length;
    await jest.advanceTimersByTimeAsync(POLL_CAIDO_MS - 1_000);
    expect(mockEnsureRelaySession.mock.calls.length).toBe(n);

    // Vuelve a SUBSCRIBED justo ANTES de que dispare el poll ya agendado: lo
    // que importa es qué intervalo se recalcula DESPUÉS de ese disparo, no
    // el disparo en sí (su demora ya estaba fijada desde que se agendó).
    for (const cb of estados.values()) cb(true);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(mockEnsureRelaySession.mock.calls.length).toBeGreaterThan(n);

    // El próximo poll ya se recalculó a 90s con el mapa en `true`.
    const n2 = mockEnsureRelaySession.mock.calls.length;
    await jest.advanceTimersByTimeAsync(POLL_OK_MS - 1_000);
    expect(mockEnsureRelaySession.mock.calls.length).toBe(n2);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(mockEnsureRelaySession.mock.calls.length).toBeGreaterThan(n2);
  });

  it('S3: sin canales todavía (arranque, invitado sin grupos) -> 20s, conservador', async () => {
    await startRelay(); // sin grupos: `syncableGroupIds()` sale vacío
    expect(estados.size).toBe(0);
    expect(intervaloDePoll()).toBe(POLL_CAIDO_MS);
  });

  it('S4: volver a primer plano relee ya, sin esperar al intervalo adaptativo', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RN = require('react-native') as typeof import('react-native');
    let appStateCb: (s: string) => void = () => {};
    jest.spyOn(RN.AppState, 'addEventListener').mockImplementation(((_type: string, cb: (s: string) => void) => {
      appStateCb = cb;
      return { remove: jest.fn() };
    }) as typeof RN.AppState.addEventListener);

    sembrarUnGrupoConClave();
    await startRelay();
    for (const cb of estados.values()) cb(true); // todos SUBSCRIBED: el próximo poll agendado sería a 90s

    const n = mockEnsureRelaySession.mock.calls.length;
    appStateCb('active');
    await jest.advanceTimersByTimeAsync(0);

    expect(mockEnsureRelaySession.mock.calls.length).toBeGreaterThan(n);
  });

  /**
   * Observación del verificador ciego (rechazo de perf/ola-b): un topic recién
   * suscripto tiene que contar como "no confirmado todavía" desde el instante
   * en que se suscribe — no sólo desde que `onStatus` lo confirma. Sin
   * sembrar `false` al suscribir, un canal MUDO (nunca llegó a disparar
   * `onStatus`, ni `true` ni `false`) queda AUSENTE del mapa, y con otro canal
   * ya confirmado en `true`, `intervaloDePoll` lo leía como "todo lo que hay
   * está OK" y prometía 90s sin que ese segundo canal hubiera confirmado nada.
   */
  it('un canal recién suscripto que todavía no confirmó nada (mudo) no permite 90s aunque otro ya esté SUBSCRIBED', async () => {
    sembrarDosGruposConClave();
    await startRelay();
    expect(estados.size).toBe(2);

    // Sólo UNO de los dos confirma — el otro queda mudo, sin `onStatus` nunca.
    const [primero] = [...estados.values()];
    primero!(true);

    expect(intervaloDePoll()).toBe(POLL_CAIDO_MS);
  });
});
