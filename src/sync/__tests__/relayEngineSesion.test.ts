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
  // R4-3: por defecto "sin operación en vuelo", así que este mock no cambia
  // el comportamiento de ningún test viejo — sólo los nuevos de R4-3 lo tocan.
  haySesionEnCurso: jest.fn(() => false),
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
  // T-147 (D4, ronda 2): `reenviarClavesDeGrupo` ahora despacha por
  // `relayQueue` usando el resultado DETALLADO (para poder reintentar
  // `rate_limited` sin perderlo) — `sendGroupKey` (boolean) queda para otros
  // llamadores (`announceGroupToContacts`), que no pasan por la cola.
  sendGroupKeyResultado: jest.fn(async () => ({ ok: true, seq: 1 })),
  announceContact: jest.fn(async () => true),
  listPeers: () => ({}),
  myContactCard: () => null,
  cardFingerprint: () => '',
  cardYaEnviada: () => false,
  marcarCardEnviada: () => {},
}));
jest.mock('../contactInviteEngine', () => ({ processAllContactInvites: jest.fn(async () => false) }));

import { startRelay, stopRelay, POLL_INTERVAL_MS, __resetReenvioClaves, announceGroupToContacts } from '../relayEngine';
import { sinSesionDeSync, __resetSessionStatus } from '../sessionStatus';
import { recordPublish, publishFailures, clearPublishFailures } from '../publishHealth';
import { __resetRelayQueue, QUEUE_INTERVAL_MS, REINTENTO_CUOTA_MS } from '../relayQueue';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Group, User } from '@/src/types/models';

const mockEnsureRelaySession = jest.requireMock('../relaySession').ensureRelaySession as jest.Mock;
const mockBindAuthRefreshToAppState = jest.requireMock('../relaySession').bindAuthRefreshToAppState as jest.Mock;
const mockSubscribeTopic = jest.requireMock('../relay').subscribeTopic as jest.Mock;
const mockSendGroupKeyResultado = jest.requireMock('../contactChannel').sendGroupKeyResultado as jest.Mock;

/**
 * T-157b: `publishToGroup`/`drainGroup` ceden el hilo entre rebanadas
 * (`cederHilo`, un `setTimeout(0)` real). Bajo fake timers eso no se resuelve
 * solo con un único `advanceTimersByTimeAsync(0)` — avanzar por 0ms no
 * garantiza que un timer agendado DURANTE ese mismo avance (por la propia
 * cadena de `cederHilo` → `encolar`) se recoja en la misma pasada. Avanzar en
 * pasos chicos y reales (1ms), varias vueltas, sí lo hace: cada vuelta ve como
 * "vencido" lo que la anterior recién agendó. 20ms de sobra alcanzan para
 * cualquier cadena razonable de este motor sin acercarse a `QUEUE_INTERVAL_MS`
 * (4s) ni a ningún otro intervalo real que el test quiera medir después.
 */
async function drenarTimersReales(vueltas = 20): Promise<void> {
  for (let i = 0; i < vueltas; i++) await jest.advanceTimersByTimeAsync(1);
}

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

/** D4: un grupo con OTRO miembro — `reenviarClavesDeGrupo` sólo manda algo
 *  cuando hay a quién mandárselo (se saltea al propio `me.id`). */
function sembrarGrupoConOtroMiembro(): void {
  useAuthStore.setState({ currentUser: { id: 'u1' } as User });
  useGroupStore.setState({
    groups: [{
      id: 'G', name: 'Grupo', memberIds: ['u1', 'u2'], currency: 'USD', createdAt: 0, createdById: 'u1',
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
  mockSendGroupKeyResultado.mockReset().mockResolvedValue({ ok: true, seq: 1 });
  clearPublishFailures();
  __resetSessionStatus();
  __resetReenvioClaves();
  __resetRelayQueue();
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
  mockEnsureRelaySession.mockResolvedValue('anonymous');

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

/**
 * BUG (T-147 post-merge): el cartel de captcha aparecía "en cualquier
 * momento" — el reintento de fondo (poll cada `POLL_INTERVAL_MS`, o al volver
 * de background) pedía sesión igual que la entrada real, y si no había
 * ninguna terminaba pidiendo un captcha nuevo encima de cualquier pantalla.
 * Decisión del PO: el captcha es SÓLO de la entrada — el poll nunca debe
 * poder abrir uno. `ensureRelaySession` ahora recibe `permitirCaptcha`, y
 * sólo la entrada real (`session.ts::rehydrateForActiveUser`) lo pasa en
 * `true`; todo lo demás (poll, join de grupo, alta de contacto, etc.) usa el
 * default `false`.
 */
describe('BUG: el captcha nunca sale de la entrada', () => {
  it('el poll pide la sesión con permitirCaptcha=false', async () => {
    sembrarUnGrupoConClave();
    await startRelay(true); // la entrada real
    mockEnsureRelaySession.mockClear();

    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(mockEnsureRelaySession).toHaveBeenCalledWith(false);
  });

  it('startRelay() sin argumento (join de grupo, alta de contacto, etc.) tampoco permite captcha', async () => {
    sembrarUnGrupoConClave();
    await startRelay();
    expect(mockEnsureRelaySession).toHaveBeenCalledWith(false);
  });

  it('startRelay(true) — la entrada real — sí permite captcha', async () => {
    sembrarUnGrupoConClave();
    await startRelay(true);
    expect(mockEnsureRelaySession).toHaveBeenCalledWith(true);
  });
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

/**
 * Verifier D4: `reenviarClavesDeGrupo` manda un sobre por (grupo, miembro
 * ajeno) en CADA `startRelay()` — sin nada que lo frene, dos arranques
 * seguidos (p. ej. el reinicio por cambio de sesión que agrega este mismo
 * ticket, D1/D2) duplican el reenvío sin necesidad: adoptar una clave que ya
 * se tiene es un no-op del lado de quien la recibe, así que repetirla antes
 * de que pase un tiempo razonable no logra nada, sólo gasta cuota.
 */
describe('D4: reenviarClavesDeGrupo no ráfaguea contra la cuota', () => {
  it('dos arranques seguidos no duplican el reenvío (cooldown)', async () => {
    sembrarGrupoConOtroMiembro();

    await startRelay();
    await jest.advanceTimersByTimeAsync(0); // la cola (ronda 2) despacha diferido
    expect(mockSendGroupKeyResultado).toHaveBeenCalledTimes(1);

    mockSendGroupKeyResultado.mockClear();
    await startRelay(); // p.ej. el reinicio de D1/D2 por cambio de sesión
    await jest.advanceTimersByTimeAsync(0);

    expect(mockSendGroupKeyResultado).not.toHaveBeenCalled();
  });
});

/**
 * Verifier D4, ronda 2 (ruling del orquestador): "una cola de publicación con
 * ritmo por debajo de la cuota... para TODO lo que manda (publicaciones de
 * grupo, `sendGroupKey`, reenvíos de claves), priorizando claves a miembros
 * nuevos". `reenviarClavesDeGrupo` ahora encola por `relayQueue` en vez de
 * mandar todo en una ráfaga sin ritmo.
 */
describe('D4 ronda 2: reenviarClavesDeGrupo pasa por la cola', () => {
  it('despacha por la cola (diferido, no en el mismo tick de startRelay)', async () => {
    sembrarGrupoConOtroMiembro();

    await startRelay();
    expect(mockSendGroupKeyResultado).not.toHaveBeenCalled(); // todavía no drenó

    await jest.advanceTimersByTimeAsync(0);
    expect(mockSendGroupKeyResultado).toHaveBeenCalledTimes(1);
  });

  it('un rate_limited de sendGroupKey se reintenta por la cola, no se pierde', async () => {
    sembrarGrupoConOtroMiembro();
    mockSendGroupKeyResultado
      .mockResolvedValueOnce({ ok: false, reason: 'rate_limited' })
      .mockResolvedValue({ ok: true, seq: 2 });

    await startRelay();
    await jest.advanceTimersByTimeAsync(0);
    expect(mockSendGroupKeyResultado).toHaveBeenCalledTimes(1); // el primero, rechazado

    // R4-2: un rate_limited espera el ritmo de la CUOTA (REINTENTO_CUOTA_MS,
    // ≥60s), no el ritmo normal de la cola.
    for (let i = 0; i < Math.ceil(REINTENTO_CUOTA_MS / QUEUE_INTERVAL_MS) + 1; i++) {
      await jest.advanceTimersByTimeAsync(QUEUE_INTERVAL_MS);
    }
    expect(mockSendGroupKeyResultado).toHaveBeenCalledTimes(2); // la cola lo reintentó solo
  });

  it('las claves de un grupo recién adoptado van con prioridad alta (antes que el reenvío de rutina)', async () => {
    // Grupo "de rutina" (ya sincronizado) con un miembro ajeno.
    sembrarGrupoConOtroMiembro();
    // Segundo grupo, adoptado por una invitación en ESTE arranque.
    useGroupStore.setState({
      groups: [
        ...useGroupStore.getState().groups,
        {
          id: 'ADOPTADO', name: 'Nuevo', memberIds: ['u1', 'u3'], currency: 'USD', createdAt: 0, createdById: 'u1',
          deletionVotes: [], updatedAt: 1_000, isDeleted: false,
        } as Group,
      ],
    });
    useGroupKeyStore.getState().ensureKey('ADOPTADO');
    const { processAllInvites } = jest.requireMock('../inviteEngine') as { processAllInvites: jest.Mock };
    processAllInvites.mockResolvedValueOnce(['ADOPTADO']);

    const orden: string[] = [];
    mockSendGroupKeyResultado.mockImplementation(async (_peer: string, group: { id: string }) => {
      orden.push(group.id);
      return { ok: true, seq: 1 };
    });

    await startRelay();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(QUEUE_INTERVAL_MS);

    expect(orden[0]).toBe('ADOPTADO');
    expect(orden).toContain('G');
  });

  /**
   * Verifier R3-3(c): `relayQueue` vive sólo en memoria — matar la app pierde
   * lo encolado, y el próximo arranque lo regenera. Pero ESE arranque nuevo
   * ya no tiene el grupo en `adoptados` (la invitación no se vuelve a
   * "adoptar", ya se adoptó la vez pasada) — sin persistir la marca, la
   * prioridad se perdería justo para el caso que más importa: un miembro
   * nuevo cuya clave no llegó a salir antes de que la app se cerrara.
   */
  it('la prioridad alta sobrevive a un reinicio (no depende de que `adoptados` la repita)', async () => {
    sembrarGrupoConOtroMiembro(); // "G": rutina
    useGroupStore.setState({
      groups: [
        ...useGroupStore.getState().groups,
        {
          id: 'ADOPTADO', name: 'Nuevo', memberIds: ['u1', 'u3'], currency: 'USD', createdAt: 0, createdById: 'u1',
          deletionVotes: [], updatedAt: 1_000, isDeleted: false,
        } as Group,
      ],
    });
    useGroupKeyStore.getState().ensureKey('ADOPTADO');
    const { processAllInvites } = jest.requireMock('../inviteEngine') as { processAllInvites: jest.Mock };
    processAllInvites.mockResolvedValueOnce(['ADOPTADO']); // sólo la PRIMERA vez

    // Primer arranque: adopta el grupo (encolado, pero la app "se cierra"
    // antes de que la cola llegue a drenarlo — no se avanza el timer).
    await startRelay();
    stopRelay();
    __resetRelayQueue(); // la cola vive en memoria: un proceso nuevo la pierde

    // Segundo arranque ("reinicio"): `adoptados` viene vacío (la invitación
    // ya se consumió), y el cooldown de `reenviarClavesDeGrupo` está vencido
    // (simula el tiempo que pasó reinstalando/reabriendo).
    processAllInvites.mockResolvedValueOnce([]);
    const ahora = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60_000);

    const orden: string[] = [];
    mockSendGroupKeyResultado.mockImplementation(async (_peer: string, group: { id: string }) => {
      orden.push(group.id);
      return { ok: true, seq: 1 };
    });

    await startRelay();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(QUEUE_INTERVAL_MS);

    expect(orden[0]).toBe('ADOPTADO'); // conservó la prioridad alta, aunque `adoptados` vino vacío
    expect(orden).toContain('G');
    ahora.mockRestore();
  });
});

/**
 * Verifier D4: `rate_limited` es no bloqueante (H6, no se muestra nada) pero
 * ESO NO PUEDE significar "se pierde": sin un reintento activo, una rebanada
 * rechazada por la cuota se queda ahí hasta que el usuario vuelva a tocar ese
 * grupo — que puede no pasar nunca. El poll ya corre cada 20s; reintentar ahí
 * los grupos con un `rate_limited` pendiente cierra el hueco sin agregar
 * ninguna llamada de red nueva mientras todo va bien.
 */
it('D4: un rate_limited se reintenta solo, sin que el usuario haga nada', async () => {
  sembrarUnGrupoConClave();
  await startRelay();

  recordPublish('G', { ok: false, reason: 'rate_limited' });
  expect(publishFailures().map(f => f.groupId)).toContain('G');

  await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
  // T-157b: el reintento pasa por `publishToGroup`, que ahora cede el hilo
  // entre rebanadas — ver `drenarTimersReales`.
  await drenarTimersReales();

  expect(publishFailures().map(f => f.groupId)).not.toContain('G');
});

/**
 * Verifier R3-3(d): la mitad de D4-bis que seguía abierta — la clave del
 * DUEÑO a un miembro nuevo (`announceGroupToContacts`, disparado al crear un
 * grupo o agregar un miembro) mandaba todo en un loop directo con
 * `sendGroupKey` booleano: un `rate_limited` se perdía sin reintento, y
 * competía por la cuota sin ningún ritmo contra lo que `reenviarClavesDeGrupo`
 * mandara al mismo tiempo. Ahora pasa por la misma cola, con prioridad alta
 * (es EXACTAMENTE el caso "miembro nuevo").
 */
describe('R3-3(d): announceGroupToContacts pasa por la cola con prioridad alta', () => {
  it('encola (no manda directo) la clave para cada miembro ajeno', async () => {
    sembrarGrupoConOtroMiembro();

    // T-157b: `publishNow` (adentro de `announceGroupToContacts`) cede el
    // hilo UNA vez entre sus dos rebanadas (grupo + manifiesto) — se dispara
    // sin esperar y se libera con UN solo avance de 0ms, antes de que
    // `encolar` programe su propio timer (ese es el que se flushea después,
    // deliberadamente aparte: es el que prueba "todavía no drenó").
    const encolPromise = announceGroupToContacts('G');
    await jest.advanceTimersByTimeAsync(0);
    const encolados = await encolPromise;

    expect(encolados).toBe(1); // u2, único miembro ajeno
    expect(mockSendGroupKeyResultado).not.toHaveBeenCalled(); // todavía no drenó

    await drenarTimersReales();
    expect(mockSendGroupKeyResultado).toHaveBeenCalledWith('u2', expect.objectContaining({ id: 'G' }), expect.any(String));
  });

  it('un rate_limited no se pierde: la cola lo reintenta', async () => {
    sembrarGrupoConOtroMiembro();
    mockSendGroupKeyResultado
      .mockResolvedValueOnce({ ok: false, reason: 'rate_limited' })
      .mockResolvedValue({ ok: true, seq: 1 });

    // T-157b: mismo motivo que en el test de arriba.
    const promesa = announceGroupToContacts('G');
    await drenarTimersReales();
    await promesa;
    await drenarTimersReales();
    expect(mockSendGroupKeyResultado).toHaveBeenCalledTimes(1);

    for (let i = 0; i < Math.ceil(REINTENTO_CUOTA_MS / QUEUE_INTERVAL_MS) + 1; i++) {
      await jest.advanceTimersByTimeAsync(QUEUE_INTERVAL_MS);
    }
    expect(mockSendGroupKeyResultado).toHaveBeenCalledTimes(2);
  });
});
