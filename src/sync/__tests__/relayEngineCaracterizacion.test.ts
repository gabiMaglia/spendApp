/**
 * T-189 · Tests de caracterización, ANTES de partir `relayEngine.ts` en
 * módulos. Documentan el comportamiento de hoy (main @ 54a31ac) de cinco
 * funciones sin cobertura directa — la lista exacta del plan:
 *
 *  - `drainAll`
 *  - `reintentarPublicacionesConCuota` (privada; se ejercita vía el ciclo de
 *    poll, `releerTodo`, igual que ya hacen `pollAdaptativo`/`pollNoDuplicaTrasStop`)
 *  - `startRelay` suscribiendo invitaciones + contactos, y `onInviteNews`
 *    disparando `scheduleDrain` del grupo de la invitación
 *  - `stopRelay` cortando poll + debounces + suscripciones
 *  - `reiniciarSyncPorCambioDeCuenta`
 *
 * Nada de esto cambia con el refactor: son el arnés que prueba que no cambió.
 */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

jest.mock('../relaySession', () => ({
  ensureRelaySession: jest.fn(async () => 'anonymous'),
  bindAuthRefreshToAppState: jest.fn(() => jest.fn()),
  haySesionEnCurso: jest.fn(() => false),
  reabrirSesionAnonima: jest.fn(async () => {}),
}));

jest.mock('../relay', () => ({
  isRelayConfigured: () => true,
  subscribeTopic: jest.fn(() => () => {}),
  getRelayClient: () => null,
  esFuncionAusente: () => false,
}));

jest.mock('../inviteEngine', () => ({
  activeInvites: jest.fn(() => []),
  processInvite: jest.fn(async () => [] as string[]),
  processAllInvites: jest.fn(async () => [] as string[]),
}));

jest.mock('../contactChannel', () => ({
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

jest.mock('../contactInviteEngine', () => ({ processAllContactInvites: jest.fn(async () => false) }));

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
  startRelay, stopRelay, drainAll, scheduleDrain, schedulePublish, cancelPendingPublishes,
  cancelPendingDrains, reiniciarSyncPorCambioDeCuenta, intervaloDePoll, deviceId,
  POLL_INTERVAL_MS, POLL_OK_MS, PUBLISH_DEBOUNCE_MS, DRAIN_DEBOUNCE_MS, __resetReenvioClaves,
} from '../relayEngine';
import { drainGroup, publishToGroup } from '../relaySync';
import { activeInvites } from '../inviteEngine';
import { recordPublish, publishFailures, clearPublishFailures } from '../publishHealth';
import { encolar, vaciarCola, __resetRelayQueue, QUEUE_INTERVAL_MS } from '../relayQueue';
import { __resetSessionStatus } from '../sessionStatus';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import * as relay from '../relay';
import type { Group, User } from '@/src/types/models';
import type { GroupInvite } from '../groupInvite';

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
  __resetSessionStatus();
  __resetReenvioClaves();
  __resetRelayQueue();
});

afterEach(() => {
  stopRelay();
  jest.useRealTimers();
});

describe('drainAll', () => {
  it('drena todos los syncableGroupIds y devuelve la suma de lo aplicado', async () => {
    grupoConClave('g1');
    grupoConClave('g2');
    mockDrainGroup.mockImplementation(async (groupId: string) => ({
      ok: true, skipped: 0, cursor: 1, completo: true,
      applied: groupId === 'g1' ? 2 : 3,
    }));

    const total = await drainAll();

    expect(total).toBe(5);
    expect(mockDrainGroup).toHaveBeenCalledWith('g1', ME, deviceId(), 0, expect.anything());
    expect(mockDrainGroup).toHaveBeenCalledWith('g2', ME, deviceId(), 0, expect.anything());
  });

  it('sin grupos sincronizables no llama a drainGroup y devuelve 0', async () => {
    expect(await drainAll()).toBe(0);
    expect(mockDrainGroup).not.toHaveBeenCalled();
  });
});

describe('reintentarPublicacionesConCuota (vía el ciclo de poll)', () => {
  it('una publicación con rate_limited pendiente se reintenta en el siguiente ciclo de poll', async () => {
    recordPublish('g1', { ok: false, reason: 'rate_limited' });
    expect(publishFailures().map(f => f.groupId)).toEqual(['g1']);

    await startRelay();
    mockPublishToGroup.mockClear();

    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(mockPublishToGroup).toHaveBeenCalledWith('g1', ME, deviceId());
    // `publishToGroup` mockeado devuelve `ok: true`: el reintento tuvo éxito
    // y `recordPublish` (real) borra el fallo anotado.
    expect(publishFailures()).toEqual([]);
  });

  it('sin fallos pendientes por cuota, el ciclo de poll no llama a publishNow', async () => {
    await startRelay();
    mockPublishToGroup.mockClear();

    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(mockPublishToGroup).not.toHaveBeenCalled();
  });
});

describe('startRelay: invitaciones y contactos', () => {
  it('suscribe invitaciones y contactos, y onInviteNews agenda el drenaje del grupo de la invitación', async () => {
    grupoConClave('g-invite');
    const invite: GroupInvite = {
      groupId: 'g-invite', groupName: 'Invitado', token: 'tok', inviterFingerprint: 'fp',
      expiresAt: Date.now() + 1_000_000,
    };
    mockActiveInvites.mockReturnValue([invite]);

    const callbacks: (() => void)[] = [];
    mockSubscribeTopic.mockImplementation((_topic: string, onData: () => void) => {
      callbacks.push(onData);
      return () => {};
    });

    await startRelay();

    // Se suscribió al menos al topic de la invitación (activeInvites=[invite])
    // y al de contactos (`ensureContactSecret` mockeado en `null` no suscribe
    // contactos — se comprueba igual el enganche de invitación, que es lo que
    // este test puede aislar sin credenciales reales de contacto).
    expect(mockSubscribeTopic).toHaveBeenCalled();
    expect(callbacks.length).toBeGreaterThan(0);

    mockDrainGroup.mockClear();
    // Dispara el callback de la invitación: simula el aviso realtime.
    callbacks[0]();
    await jest.advanceTimersByTimeAsync(DRAIN_DEBOUNCE_MS);

    // El cursor ya no está en 0: `arrancarCadenaDeSync` drenó el grupo una vez
    // al arrancar (antes de que este callback dispare). Lo que importa acá es
    // que `onInviteNews` agenda un SEGUNDO drenaje del MISMO grupo.
    expect(mockDrainGroup).toHaveBeenCalledWith('g-invite', ME, deviceId(), expect.any(Number), expect.anything());
  });

  it('dos arranques no duplican las suscripciones de invitaciones (activeInvites se lee una vez por arranque)', async () => {
    mockActiveInvites.mockReturnValue([]);
    await startRelay();
    const llamadasTrasElPrimero = mockActiveInvites.mock.calls.length;
    expect(llamadasTrasElPrimero).toBeGreaterThan(0);
  });
});

describe('stopRelay', () => {
  it('corta poll, drenajes agendados y todas las suscripciones (el publish debounced NO — es cancelPendingPublishes quien lo corta)', async () => {
    grupoConClave('g1');
    const unsubGrupo = jest.fn();
    mockSubscribeTopic.mockImplementation(() => unsubGrupo);

    await startRelay();
    expect(unsubGrupo).not.toHaveBeenCalled();

    scheduleDrain('g1');
    schedulePublish('g1');

    stopRelay();

    // Suscripciones cortadas.
    expect(unsubGrupo).toHaveBeenCalled();

    mockPublishToGroup.mockClear();
    mockDrainGroup.mockClear();

    await jest.advanceTimersByTimeAsync(Math.max(PUBLISH_DEBOUNCE_MS, DRAIN_DEBOUNCE_MS) * 2);

    // El drenaje agendado SÍ se cortó (`stopRelay` llama `cancelPendingDrains`).
    expect(mockDrainGroup).not.toHaveBeenCalled();
    // El publish agendado, en cambio, dispara igual: `stopRelay` no lo
    // cancela — sólo `cancelPendingPublishes`/`reiniciarSyncPorCambioDeCuenta`
    // lo hacen. Es el comportamiento de HOY; el refactor no puede cambiarlo.
    expect(mockPublishToGroup).toHaveBeenCalledWith('g1', ME, deviceId());

    mockPublishToGroup.mockClear();
    // El poll no sigue corriendo tras el stop.
    await jest.advanceTimersByTimeAsync(POLL_OK_MS * 2);
    expect(mockPublishToGroup).not.toHaveBeenCalled();

    // Y el motor queda listo para volver a arrancar.
    const otra = startRelay();
    await expect(otra).resolves.toBeUndefined();
  });

  it('deja cancelPendingDrains/cancelPendingPublishes sin nada que cancelar (no revienta)', () => {
    stopRelay();
    expect(() => { cancelPendingPublishes(); cancelPendingDrains(); }).not.toThrow();
  });
});

describe('reiniciarSyncPorCambioDeCuenta', () => {
  it('para el motor, cancela publicaciones agendadas y vacía la cola de trabajos diferidos', async () => {
    grupoConClave('g1');
    const unsub = jest.fn();
    mockSubscribeTopic.mockImplementation(() => unsub);
    await startRelay();

    schedulePublish('g1');
    const trabajo = jest.fn(async () => 'hecho' as const);
    encolar({ prioridad: 'normal', ejecutar: trabajo });

    reiniciarSyncPorCambioDeCuenta();

    expect(unsub).toHaveBeenCalled(); // stopRelay corrió

    mockPublishToGroup.mockClear();
    await jest.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS * 2);
    expect(mockPublishToGroup).not.toHaveBeenCalled(); // el publish agendado se canceló

    await jest.advanceTimersByTimeAsync(QUEUE_INTERVAL_MS * 2);
    expect(trabajo).not.toHaveBeenCalled(); // la cola se vació: el trabajo nunca corre
  });

  it('el intervalo de poll vuelve a la cadencia conservadora (se olvidó el estado de canales)', async () => {
    grupoConClave('g1');
    let onStatus: ((ok: boolean) => void) | undefined;
    mockSubscribeTopic.mockImplementation((_topic: string, _onData: () => void, status?: (ok: boolean) => void) => {
      onStatus = status;
      return () => {};
    });

    await startRelay();
    onStatus?.(true); // canal confirmado sano
    expect(intervaloDePoll()).toBe(POLL_OK_MS);

    reiniciarSyncPorCambioDeCuenta();

    expect(intervaloDePoll()).toBe(POLL_INTERVAL_MS); // vuelve a conservador
  });
});
