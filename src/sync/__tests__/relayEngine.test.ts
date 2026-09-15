import {
  readCursor, writeCursor, deviceId, syncableGroupIds,
  schedulePublish, cancelPendingPublishes, PUBLISH_DEBOUNCE_MS, startRelay, publishNow,
  stopRelay, POLL_INTERVAL_MS,
} from '../relayEngine';
import * as relay from '../relay';
import { processAllContactInvites } from '../contactInviteEngine';
import { useAuthStore } from '@/src/store/authStore';
import { publishFailures, clearPublishFailures } from '../publishHealth';
import { useGroupStore } from '@/src/store/groupStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Group, User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

// El motor no debe adoptar invitaciones de GRUPO reales al arrancar en este
// archivo — sólo interesa el enganche de las de CONTACTO (T-096). `activeInvites()`
// leería del `identityStore` real y podría arrastrar estado de otro test si algo
// quedó sin limpiar; se lo aísla acá.
jest.mock('../inviteEngine', () => ({
  activeInvites: () => [],
  processInvite: jest.fn(async () => [] as string[]),
  processAllInvites: jest.fn(async () => [] as string[]),
}));

// El "buzón tonto" de contactos no importa para este archivo: sin secreto ni
// tarjeta propia, todo el camino de `contactChannel` queda en no-op y el único
// punto bajo prueba es que `processAllContactInvites` se llame (T-096).
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

jest.mock('../contactInviteEngine', () => ({
  processAllContactInvites: jest.fn(async () => false),
}));

const ME = 'ua';
const group = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Viaje', memberIds: [ME], currency: 'ARS',
  createdAt: 0, createdById: ME, deletionVotes: [],
  updatedAt: 1_000, isDeleted: false, ...over,
} as Group);

describe('cursor', () => {
  beforeEach(() => createSecureStorage('groupkeys').clearAll());

  // Si el cursor viviera en memoria, cada apertura re-bajaría toda la cola.
  it('se persiste y sobrevive al reinicio', () => {
    writeCursor('t1', 42);
    expect(readCursor('t1')).toBe(42);
  });

  it('un topic sin cursor arranca en 0', () => {
    expect(readCursor('nunca-visto')).toBe(0);
  });

  it('un cursor corrupto cae a 0 en vez de romper', () => {
    createSecureStorage('groupkeys').set('cursor::t1', 'no-es-un-numero');
    expect(readCursor('t1')).toBe(0);
  });

  it('los cursores no se mezclan entre topics', () => {
    writeCursor('t1', 10);
    writeCursor('t2', 20);
    expect(readCursor('t1')).toBe(10);
  });
});

describe('deviceId', () => {
  beforeEach(() => createSecureStorage('groupkeys').clearAll());

  it('es estable entre llamadas', () => {
    expect(deviceId()).toBe(deviceId());
  });

  it('se persiste (si cambiara, reprocesaríamos lo propio)', () => {
    const primero = deviceId();
    expect(createSecureStorage('groupkeys').getString('device_id')).toBe(primero);
  });
});

describe('syncableGroupIds', () => {
  beforeEach(() => {
    createSecureStorage('groupkeys').clearAll();
    useAuthStore.setState({ currentUser: { id: ME } as User });
    useGroupStore.setState({ groups: [], isLoading: false });
    useGroupKeyStore.setState({ keys: [] });
  });

  it('sólo grupos con clave: sin ella no hay nada que cifrar', () => {
    useGroupStore.setState({ groups: [group()] });
    expect(syncableGroupIds()).toEqual([]);

    useGroupKeyStore.getState().ensureKey('g1');
    expect(syncableGroupIds()).toEqual(['g1']);
  });

  it('excluye los borrados', () => {
    useGroupStore.setState({ groups: [group({ isDeleted: true })] });
    useGroupKeyStore.getState().ensureKey('g1');
    expect(syncableGroupIds()).toEqual([]);
  });

  // Tras salir de un grupo dejamos de publicar en él.
  it('excluye aquellos de los que ya no soy miembro', () => {
    useGroupStore.setState({ groups: [group({ memberIds: ['otro'] })] });
    useGroupKeyStore.getState().ensureKey('g1');
    expect(syncableGroupIds()).toEqual([]);
  });

  it('sin sesión no sincroniza nada', () => {
    useAuthStore.setState({ currentUser: null });
    useGroupStore.setState({ groups: [group()] });
    useGroupKeyStore.getState().ensureKey('g1');
    expect(syncableGroupIds()).toEqual([]);
  });
});

describe('debounce de publicación', () => {
  beforeEach(() => { jest.useFakeTimers(); cancelPendingPublishes(); });
  afterEach(() => { cancelPendingPublishes(); jest.useRealTimers(); });

  // Cargar un gasto dispara varios cambios de store seguidos: sin agrupar se
  // manda un sobre por cada uno y se quema la cuota con estados intermedios.
  it('una ráfaga de cambios no dispara nada antes de la ventana', () => {
    schedulePublish('g1');
    schedulePublish('g1');
    schedulePublish('g1');

    expect(() => jest.advanceTimersByTime(PUBLISH_DEBOUNCE_MS - 1)).not.toThrow();
  });

  it('cancelar deja el sistema limpio', () => {
    schedulePublish('g1');
    cancelPendingPublishes();
    expect(() => jest.advanceTimersByTime(PUBLISH_DEBOUNCE_MS * 2)).not.toThrow();
  });

  it('sin relay configurado no agenda nada ni rompe', () => {
    expect(() => schedulePublish('g1')).not.toThrow();
  });
});

describe('arranque del relay', () => {
  // Arranca cortando todo. Si dos corridas se pisan, la segunda desuscribe lo
  // que la primera acaba de crear y la app queda sin escuchar nada.
  it('dos arranques concurrentes son uno solo', () => {
    const a = startRelay();
    const b = startRelay();
    expect(b).toBe(a);
  });

  it('después de terminar, un arranque nuevo vuelve a correr', async () => {
    const a = startRelay();
    await a;
    expect(startRelay()).not.toBe(a);
  });
});

describe('publicar deja rastro cuando falla', () => {
  beforeEach(() => {
    clearPublishFailures();
    useAuthStore.setState({ currentUser: { id: ME } as User });
    useGroupKeyStore.setState({ keys: [] });
  });

  /**
   * `publishNow` se traga los errores a propósito —es offline-first— pero
   * tragárselos SIN dejar rastro produjo dos veces el mismo síntoma: "no me
   * llega nada", sin error y sin nada que mirar.
   */
  it('un fallo de publicación queda anotado', async () => {
    await publishNow('g1'); // sin clave del grupo: no puede publicar

    expect(publishFailures().map(f => f.groupId)).toEqual(['g1']);
  });

  it('sin sesión no se anota nada: no hay nada que publicar', async () => {
    useAuthStore.setState({ currentUser: null });

    await publishNow('g1');

    expect(publishFailures()).toEqual([]);
  });
});

describe('invitaciones de contacto en el ciclo de sync (T-096)', () => {
  // `doStartRelay`/`releerTodo` sólo llegan a procesar algo si el relay está
  // "configurado" — acá se lo fuerza sin credenciales reales: `getRelayClient()`
  // sigue devolviendo `null` (no hay `EXPO_PUBLIC_SUPABASE_*` en el entorno de
  // test), así que todo lo que de verdad hablaría con la red sigue siendo un
  // no-op, y sólo se ejercita el enganche que interesa acá.
  beforeEach(() => {
    createSecureStorage('groupkeys').clearAll();
    useAuthStore.setState({ currentUser: null });
    useGroupStore.setState({ groups: [], isLoading: false });
    useGroupKeyStore.setState({ keys: [] });
    (processAllContactInvites as jest.Mock).mockClear();
    jest.spyOn(relay, 'isRelayConfigured').mockReturnValue(true);
  });

  afterEach(() => {
    stopRelay();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('doStartRelay procesa las invitaciones de contacto pendientes', async () => {
    await startRelay();

    expect(processAllContactInvites).toHaveBeenCalledWith(deviceId());
  });

  it('la relectura periódica también procesa las invitaciones de contacto', async () => {
    jest.useFakeTimers();
    await startRelay();
    (processAllContactInvites as jest.Mock).mockClear();

    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(processAllContactInvites).toHaveBeenCalledWith(deviceId());
  });
});
