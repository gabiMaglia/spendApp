/**
 * T-252 · Un fallo de publicación no se pierde: marca persistente + reintento
 * en arranque, poll y primer plano.
 */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

jest.mock('@/src/sync/sesion/relaySession', () => ({
  ensureRelaySession: jest.fn(async () => 'anonymous'),
  bindAuthRefreshToAppState: jest.fn(() => jest.fn()),
  haySesionEnCurso: jest.fn(() => false),
  reabrirSesionAnonima: jest.fn(async () => {}),
}));

jest.mock('@/src/sync/adaptadores/supabase/relay', () => ({
  isRelayConfigured: () => true,
  subscribeTopic: jest.fn(() => () => {}),
  getRelayClient: () => null,
  esFuncionAusente: () => false,
}));

jest.mock('@/src/sync/invitaciones/inviteEngine', () => ({
  activeInvites: jest.fn(() => []),
  processInvite: jest.fn(async () => [] as string[]),
  processAllInvites: jest.fn(async () => [] as string[]),
}));

jest.mock('@/src/sync/contactos/contactChannel', () => ({
  ensureContactSecret: () => null,
  deriveContactTopic: jest.fn(async () => 'topic-contactos'),
  drainContacts: jest.fn(async () => ({ cursor: 0, added: 0, joinedGroups: [], conflictedGroups: [] })),
  sendGroupKeyResultado: jest.fn(async () => ({ ok: true, seq: 1 })),
  announceCardResultado: jest.fn(async () => ({ ok: true, seq: 1 })),
  listPeers: () => ({}),
  myContactCard: () => null,
  cardFingerprint: () => '',
  cardYaEnviada: () => false,
  marcarCardEnviada: () => {},
}));

jest.mock('@/src/sync/contactos/contactInviteEngine', () => ({ processAllContactInvites: jest.fn(async () => false) }));

// `drainNow`/`publishNow` hablan con `relaySync` de verdad para descifrar y
// aplicar — se lo reemplaza para poder decidir, por groupId, qué devuelve
// cada llamada sin tener que fabricar sobres cifrados reales.
jest.mock('../relaySync', () => ({
  ...jest.requireActual('../relaySync'),
  drainGroup: jest.fn(async () => ({ ok: true, applied: 0, skipped: 0, cursor: 1, completo: true })),
  publishToGroup: jest.fn(async () => ({ ok: true, seq: 1 })),
  sigueSiendoLaClave: jest.fn(() => true),
}));

import {
  startRelay, stopRelay, schedulePublish, drainNow, deviceId,
  POLL_CAIDO_MS, PUBLISH_DEBOUNCE_MS, __resetReenvioClaves,
} from '../relayEngine';
import { __resetReintentos } from '../agendaDePublicacion';
import {
  estaPublicacionPendiente, marcarPublicacionPendiente,
} from '../publicacionPendiente';
import { marcarPendienteDeDrenaje } from '../pendingDrain';
import { drainGroup, publishToGroup } from '../relaySync';
import { activeInvites } from '@/src/sync/invitaciones/inviteEngine';
import { clearPublishFailures } from '../publishHealth';
import { encolar, __resetRelayQueue, QUEUE_INTERVAL_MS } from '../relayQueue';
import { __resetSessionStatus } from '@/src/sync/sesion/sessionStatus';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import * as relay from '@/src/sync/adaptadores/supabase/relay';
import type { Group, User } from '@/src/types/models';

const mockSubscribeTopic = relay.subscribeTopic as jest.Mock;
const mockDrainGroup = drainGroup as jest.Mock;
const mockPublishToGroup = publishToGroup as jest.Mock;
const mockActiveInvites = activeInvites as jest.Mock;

const ME = 'ua';

function grupoConClave(id: string, memberIds: string[] = [ME]): void {
  useGroupStore.setState(s => ({
    groups: [...s.groups.filter(g => g.id !== id), {
      id, name: `Grupo ${id}`, memberIds, currency: 'ARS', createdAt: 0, createdById: ME,
      updatedAt: 1_000, isDeleted: false,
    } as Group],
    isLoading: false,
  }));
  useGroupKeyStore.getState().ensureKey(id);
}

beforeEach(() => {
  jest.useFakeTimers();
  createSecureStorage('groupkeys').clearAll();
  useAuthStore.setState({ currentUser: { id: ME } as User });
  useGroupStore.setState({ groups: [], isLoading: false });
  useGroupKeyStore.setState({ keys: [] });
  mockSubscribeTopic.mockReset().mockImplementation(() => () => {});
  mockDrainGroup.mockReset().mockResolvedValue({ ok: true, applied: 0, skipped: 0, cursor: 1, completo: true });
  mockPublishToGroup.mockReset().mockResolvedValue({ ok: true, seq: 1 });
  mockActiveInvites.mockReset().mockReturnValue([]);
  clearPublishFailures();
  __resetReintentos();
  __resetSessionStatus();
  __resetReenvioClaves();
  __resetRelayQueue();
});

afterEach(() => {
  stopRelay();
  jest.useRealTimers();
});


const RED = { ok: false, reason: 'network', detail: 'sin señal' };

describe('T-252 · cola persistente de publicaciones', () => {
  it('programar una publicación marca el grupo ANTES del debounce (la app puede morir adentro)', () => {
    grupoConClave('g1');
    schedulePublish('g1');
    expect(estaPublicacionPendiente('g1')).toBe(true);
    expect(mockPublishToGroup).not.toHaveBeenCalled();
  });

  it('un éxito baja la marca', async () => {
    grupoConClave('g1');
    schedulePublish('g1');
    await jest.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS);
    expect(mockPublishToGroup).toHaveBeenCalledTimes(1);
    expect(estaPublicacionPendiente('g1')).toBe(false);
  });

  it('un fallo de red deja la marca y el poll lo reintenta hasta que sale', async () => {
    grupoConClave('g1');
    await startRelay();
    mockPublishToGroup.mockClear().mockResolvedValue(RED);

    schedulePublish('g1');
    await jest.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS);
    expect(estaPublicacionPendiente('g1')).toBe(true);

    // vuelve la red
    mockPublishToGroup.mockClear().mockResolvedValue({ ok: true, seq: 2 });
    await jest.advanceTimersByTimeAsync(POLL_CAIDO_MS * 3); // pasa el backoff

    expect(mockPublishToGroup).toHaveBeenCalledWith('g1', ME, deviceId());
    expect(estaPublicacionPendiente('g1')).toBe(false);
  });

  it('el backoff evita martillar: tras un fallo no reintenta en la vuelta siguiente', async () => {
    grupoConClave('g1');
    await startRelay();
    mockPublishToGroup.mockClear().mockResolvedValue(RED);

    schedulePublish('g1');
    await jest.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS);
    expect(mockPublishToGroup).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(POLL_CAIDO_MS); // una vuelta: todavía en espera
    expect(mockPublishToGroup).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(POLL_CAIDO_MS * 2); // ya pasó la espera
    expect(mockPublishToGroup.mock.calls.length).toBeGreaterThan(1);
  });

  it('un rechazo permanente del servidor (RLS) espera el tope, no 30 s', async () => {
    grupoConClave('g1');
    await startRelay();
    mockPublishToGroup.mockClear().mockResolvedValue({ ok: false, reason: 'network', detail: 'new row violates row-level security policy' });

    schedulePublish('g1');
    await jest.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS);
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(mockPublishToGroup).toHaveBeenCalledTimes(1);
  });

  it('reinicio con la marca pendiente: el arranque publica (después de drenar)', async () => {
    grupoConClave('g1');
    marcarPublicacionPendiente('g1'); // quedó de la sesión anterior
    const orden: string[] = [];
    mockDrainGroup.mockImplementation(async () => { orden.push('drain'); return { ok: true, applied: 0, skipped: 0, cursor: 1, completo: true }; });
    mockPublishToGroup.mockImplementation(async () => { orden.push('publish'); return { ok: true, seq: 1 }; });

    await startRelay();

    expect(orden).toContain('publish');
    expect(orden.indexOf('publish')).toBeGreaterThan(orden.lastIndexOf('drain'));
    expect(estaPublicacionPendiente('g1')).toBe(false);
  });

  it('volver a primer plano (releer) también publica lo pendiente', async () => {
    grupoConClave('g1');
    await startRelay();
    mockPublishToGroup.mockClear();
    marcarPublicacionPendiente('g1');

    await jest.advanceTimersByTimeAsync(POLL_CAIDO_MS);

    expect(mockPublishToGroup).toHaveBeenCalledWith('g1', ME, deviceId());
  });

  it('pending_drain: no publica, y cuando el drenaje termina SÍ publica', async () => {
    grupoConClave('g1');
    marcarPendienteDeDrenaje('g1');
    schedulePublish('g1', 0);
    await jest.advanceTimersByTimeAsync(10);
    expect(mockPublishToGroup).not.toHaveBeenCalled();
    expect(estaPublicacionPendiente('g1')).toBe(true);

    await drainNow('g1');
    await jest.advanceTimersByTimeAsync(0);

    expect(mockPublishToGroup).toHaveBeenCalledWith('g1', ME, deviceId());
    expect(estaPublicacionPendiente('g1')).toBe(false);
  });

  it('un cambio nuevo durante la publicación en vuelo no se pierde: la marca sobrevive a ese ok', async () => {
    grupoConClave('g1');
    let soltar: (v: unknown) => void = () => {};
    mockPublishToGroup.mockImplementationOnce(() => new Promise(r => { soltar = r; }));

    schedulePublish('g1', 0);
    await jest.advanceTimersByTimeAsync(1);
    marcarPublicacionPendiente('g1'); // otro gasto mientras vuela
    soltar({ ok: true, seq: 1 });
    await jest.advanceTimersByTimeAsync(1);

    expect(estaPublicacionPendiente('g1')).toBe(true);
  });
});
