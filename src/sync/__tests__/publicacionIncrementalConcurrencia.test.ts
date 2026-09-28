/**
 * V3 (verifier, T-191 segunda tanda) — `publishToGroup` no estaba serializado
 * por topic. Con dos llamadas concurrentes para el MISMO grupo (una ráfaga de
 * ediciones que dispara `schedulePublish` más un `publishNow` directo, o el
 * reintento de `reintentarPublicacionesConCuota` solapado con un cambio
 * nuevo) y respuestas de red en ORDEN INVERTIDO, el ledger puede terminar
 * registrando el digest de la publicación MÁS NUEVA mientras el buzón —del
 * otro lado— quedó compactado con el contenido de la MÁS VIEJA (la que
 * llegó al servidor después, por azar de la red). Consecuencia: una tercera
 * publicación (sin cambios locales) cree que todo sigue al día y nunca
 * vuelve a mandar el cubo — la edición se pierde silenciosamente para el
 * resto del grupo.
 *
 * Fix elegido: una cola de promesas por `topic` en `publishToGroup` — una
 * publicación en vuelo por grupo; la siguiente espera a que la anterior
 * termine (mismo patrón que usa Jazz/CoJSON para serializar escrituras por
 * CoValue). Este archivo prueba el INVARIANTE que la cola garantiza (nunca
 * dos `sendEnvelope` del mismo topic en vuelo a la vez) y la consecuencia
 * observable (el estado final publicado es consistente, sin gap).
 */
jest.mock('../relay', () => {
  const buzones = new Map<string, { seq: number; topic: string; payload: string; sender: string; compactable?: boolean; ckey?: string }[]>();
  let seq = 0;
  let enCurso = 0;
  let maxEnCurso = 0;
  return {
    __buzones: buzones,
    __reset: () => { buzones.clear(); seq = 0; enCurso = 0; maxEnCurso = 0; },
    __maxEnCurso: () => maxEnCurso,
    isRelayConfigured: () => true,
    subscribeTopic: () => () => {},
    // Compacta por (sender, ckey) AL LLEGAR, como el servidor real (T-032) —
    // y cede un tick de verdad (`setImmediate`) antes de "escribir", para que
    // dos llamadas concurrentes SIN la cola tengan chance real de
    // entrelazarse (si estuviera todo síncrono, nunca se vería la carrera).
    sendEnvelope: async (topic: string, payload: string, sender: string, compactable = false, ckey?: string) => {
      enCurso++;
      maxEnCurso = Math.max(maxEnCurso, enCurso);
      await new Promise<void>(resolve => setImmediate(resolve));
      enCurso--;
      const lista = (buzones.get(topic) ?? []).filter(e => !(compactable && ckey && e.sender === sender && e.ckey === ckey));
      const mine = ++seq;
      lista.push({ seq: mine, topic, payload, sender, compactable, ckey });
      buzones.set(topic, lista);
      return { ok: true, seq: mine };
    },
    fetchSince: async (topic: string, since: number, excludeSender?: string, limit = 200) => {
      const lista = (buzones.get(topic) ?? []).filter(e => e.seq > since && e.sender !== excludeSender).slice(0, limit);
      return { ok: true, envelopes: lista, cursor: lista.length ? lista[lista.length - 1]!.seq : since, more: lista.length === limit };
    },
    deleteMyEnvelopes: async () => ({ ok: true }),
  };
});
jest.mock('../authorHealth', () => ({ observeAuthor: jest.fn(async () => 'ok'), RECHAZAR_AUTORES_NO_VERIFICADOS: false }));
jest.mock('../authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));

// M2 (verifier, tercera tanda): `adaptador.antesDePublicar` es la parte de
// `publishToGroup` que puede demorar de verdad (espera `publishAvatarIfOwn`,
// red) — se envuelve para poder demorarla A PROPÓSITO y ver qué pasa si el
// estado local cambia DURANTE esa espera. La demora se ata al CONTENIDO del
// documento (la descripción del gasto capturado), no a "la próxima llamada":
// cuál de las dos publicaciones concurrentes llega primero a
// `antesDePublicar` no está garantizado por el event loop, y atarlo a
// contenido es lo único que hace el test determinista de verdad.
jest.mock('../relay/adaptadorHushSplit', () => {
  const actual = jest.requireActual('../relay/adaptadorHushSplit');
  let demorarSiDescripcion: string | null = null;
  return {
    ...actual,
    __demorarSiDescripcion: (desc: string | null) => { demorarSiDescripcion = desc; },
    antesDePublicar: async (doc: { expenses?: { description?: string }[] }, ctx: unknown) => {
      if (demorarSiDescripcion && doc?.expenses?.[0]?.description === demorarSiDescripcion) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return actual.antesDePublicar(doc, ctx);
    },
  };
});

import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { publishToGroup, drainGroup, PUBLICACION_TIMEOUT_MS } from '../relaySync';
import { manifestGapFor, clearManifestGaps } from '../manifestHealth';
import type { Group, Expense } from '@/src/types/models';

const relayMock = jest.requireMock('../relay') as {
  __reset: () => void;
  __maxEnCurso: () => number;
};
const adaptadorMock = jest.requireMock('../relay/adaptadorHushSplit') as {
  __demorarSiDescripcion: (desc: string | null) => void;
};

const grupo = (): Group => ({
  id: 'G', name: 'Grupo', memberIds: ['u1'], currency: 'USD', createdAt: 1, createdById: 'u1',
  miembros: {}, updatedAt: 1_000, isDeleted: false,
} as Group);
const gasto = (id: string, description = 'x', updatedAt = 1_000): Expense => ({
  id, groupId: 'G', description, amount: 10, currency: 'USD', paidById: 'u1',
  splits: [{ userId: 'u1', amount: 10, isPaid: false }], splitMode: 'equal', category: 'other',
  date: 1, createdAt: 1, createdById: 'u1', updatedAt, isDeleted: false,
} as Expense);

beforeEach(() => {
  relayMock.__reset();
  clearManifestGaps();
  useAuthStore.setState({ currentUser: { id: 'u1' } } as never);
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
  useGroupStore.setState({ groups: [grupo()] } as never);
  useExpenseStore.setState({ expenses: [] } as never);
});

it('V3: dos publishToGroup concurrentes del mismo grupo nunca tienen sends en vuelo a la vez, y el estado final es consistente', async () => {
  useExpenseStore.setState({ expenses: [gasto('e1', 'v1', 1_000)] } as never);
  const p1 = publishToGroup('G', 'u1', 'device1');

  useExpenseStore.setState({ expenses: [gasto('e1', 'v2', 2_000)] } as never);
  const p2 = publishToGroup('G', 'u1', 'device1');

  const [r1, r2] = await Promise.all([p1, p2]);
  expect(r1.ok).toBe(true);
  expect(r2.ok).toBe(true);

  // El invariante que la cola garantiza: nunca dos sends del mismo topic en
  // vuelo a la vez — sin la cola, esto da 2 (el punto exacto de la carrera).
  expect(relayMock.__maxEnCurso()).toBe(1);

  // Consecuencia observable: un tercero que entra ve el estado FINAL
  // consistente (v2), no una mezcla rota entre lo que el ledger cree
  // publicado y lo que el buzón realmente compactó.
  useExpenseStore.setState({ expenses: [] } as never);
  const r = await drainGroup('G', 'u2', 'deviceNuevo', 0);
  expect(r.ok).toBe(true);
  expect(manifestGapFor('G')).toBeNull();
  expect(useExpenseStore.getState().expenses.find(e => e.id === 'e1')?.description).toBe('v2');
});

/**
 * M2 (verifier, tercera tanda): el documento se armaba (`adaptador.armar` +
 * `antesDePublicar`) ANTES de entrar a la cola por topic — si P1 toma el
 * snapshot v1 y se demora ahí (esperando `publishAvatarIfOwn`, red), P2 puede
 * tomar v2 y entrar a la cola PRIMERO (la encuentra vacía): el buzón termina
 * con v2, y recién después P1 —que sigue con su snapshot viejo, v1— vuelve y
 * lo pisa. Fix: `armar`/`antesDePublicar` se mueven ADENTRO de la tarea
 * encolada — el estado se toma cuando a la publicación le toca el turno, no
 * cuando se la llama.
 */
it('M2a: el estado se toma AL TURNO de la cola, no al llamar — el buzón termina con el más nuevo', async () => {
  adaptadorMock.__demorarSiDescripcion('v1'); // la publicación que captura v1 es la que se demora
  useExpenseStore.setState({ expenses: [gasto('e1', 'v1', 1_000)] } as never);
  const p1 = publishToGroup('G', 'u1', 'device1');

  // Deja que P1 llegue a `armar()` (captura v1) y arranque su demora de
  // 50ms ANTES de mutar el estado — si no, la mutación síncrona de acá abajo
  // corre ANTES que la continuación de P1 (que recién se reanuda como
  // microtarea tras `await deriveTopic`), y P1 terminaría capturando v2 él
  // también: no habría ninguna carrera que observar.
  await new Promise(resolve => setTimeout(resolve, 5));

  useExpenseStore.setState({ expenses: [gasto('e1', 'v2', 2_000)] } as never);
  const p2 = publishToGroup('G', 'u1', 'device1');

  const [r1, r2] = await Promise.all([p1, p2]);
  adaptadorMock.__demorarSiDescripcion(null);
  expect(r1.ok).toBe(true);
  expect(r2.ok).toBe(true);

  useExpenseStore.setState({ expenses: [] } as never);
  const r = await drainGroup('G', 'u2', 'deviceNuevo', 0);
  expect(r.ok).toBe(true);
  expect(manifestGapFor('G')).toBeNull();
  // Sin el fix, esto da 'v1': P1 (snapshot viejo) llega a la cola DESPUÉS de
  // P2 y pisa el buzón con contenido más viejo que el estado local real.
  expect(useExpenseStore.getState().expenses.find(e => e.id === 'e1')?.description).toBe('v2');
});

/**
 * M2 (segunda parte): un `sendEnvelope` que nunca resuelve dejaba la cola del
 * topic trabada para siempre — nada volvía a publicarse en ese grupo hasta
 * reiniciar la app. `PUBLICACION_TIMEOUT_MS` (`withTimeout`, mismo patrón que
 * `EJECUCION_TIMEOUT_MS`/`SESSION_TIMEOUT_MS`) corta la espera y libera la
 * cola — la publicación colgada vuelve `{ok:false, reason:'network'}`.
 */
it('M2b: un envío colgado no bloquea la cola para siempre — la siguiente publicación pasa tras el timeout', async () => {
  jest.useFakeTimers();
  try {
    const relayModule = jest.requireMock('../relay') as {
      sendEnvelope: (...args: unknown[]) => Promise<unknown>;
    };
    const sendEnvelopeOriginal = relayModule.sendEnvelope;
    let primeraLlamada = true;
    relayModule.sendEnvelope = jest.fn((...args: unknown[]) => {
      if (primeraLlamada) {
        primeraLlamada = false;
        return new Promise(() => {}); // nunca resuelve ni rechaza
      }
      return sendEnvelopeOriginal(...args);
    });

    useExpenseStore.setState({ expenses: [gasto('e1', 'v1', 1_000)] } as never);
    const p1 = publishToGroup('G', 'u1', 'device1'); // su primer envío queda colgado

    await jest.advanceTimersByTimeAsync(PUBLICACION_TIMEOUT_MS + 1_000);
    const r1 = await p1;
    expect(r1.ok).toBe(false); // el timeout lo corta

    // La cola del topic quedó libre: la siguiente publicación NO espera al
    // que se colgó — corre y termina normalmente.
    useExpenseStore.setState({ expenses: [gasto('e1', 'v2', 2_000)] } as never);
    const p2 = publishToGroup('G', 'u1', 'device1');
    await jest.advanceTimersByTimeAsync(0);
    const r2 = await p2;
    expect(r2.ok).toBe(true);

    relayModule.sendEnvelope = sendEnvelopeOriginal;
  } finally {
    jest.useRealTimers();
  }
});
