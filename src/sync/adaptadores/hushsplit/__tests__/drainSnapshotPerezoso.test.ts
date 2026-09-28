/**
 * T-158b: la "foto previa" de `drainNow` (`snapshot(...)`, la que distingue
 * "llegó recién" de "ya estaba" para los avisos de T-010) se calculaba SIEMPRE,
 * en cada drenaje — incluidos los que no traían un solo sobre nuevo (la
 * inmensa mayoría de las vueltas de poll, en un grupo tranquilo). Es trabajo
 * de JS sobre potencialmente miles de gastos, tirado a la basura la mayoría
 * de las veces.
 *
 * `drainGroup` ahora recibe `opts.antesDeAplicar`, una función que invoca UNA
 * SOLA VEZ, justo antes de aplicar la primera página que trae sobres — nunca
 * si el buzón está vacío. `drainNow` la usa para tomar la foto perezosamente:
 * si nunca se llamó (buzón vacío), no hay foto y no se calculan avisos.
 *
 * **Verifier ciego (B2, rechazo de perf/ola-b): esta suite mockeaba
 * `drainGroup` ENTERO** — la aserción de orden era tautológica, porque el
 * propio mock decidía cuándo llamar a `antesDeAplicar`; no probaba nada del
 * código real. Ahora corre con un buzón REAL en memoria (mismo patrón que
 * `cederHiloEntreRebanadas.test.ts`) y `drainGroup`/`applyDelta` SIN mockear
 * — sólo se espían con `jest.fn(actual.fn)` para poder medir orden y conteo
 * sin cambiar el comportamiento.
 */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

jest.mock('../../supabase/relay', () => {
  const buzones = new Map<string, { seq: number; topic: string; payload: string; sender: string; compactable?: boolean; ckey?: string }[]>();
  let seq = 0;
  return {
    __buzones: buzones,
    __reset: () => { buzones.clear(); seq = 0; },
    isRelayConfigured: () => true,
    subscribeTopic: () => () => {},
    sendEnvelope: async (topic: string, payload: string, sender: string, compactable = false, ckey?: string) => {
      const lista = buzones.get(topic) ?? [];
      lista.push({ seq: ++seq, topic, payload, sender, compactable, ckey });
      buzones.set(topic, lista);
      return { ok: true, seq };
    },
    fetchSince: async (topic: string, since: number, excludeSender?: string) => {
      const lista = (buzones.get(topic) ?? []).filter(e => e.seq > since && e.sender !== excludeSender);
      return { ok: true, envelopes: lista, cursor: lista.length ? lista[lista.length - 1]!.seq : since };
    },
    deleteMyEnvelopes: async () => ({ ok: true }),
  };
});

// Diagnóstico de autoría fuera de banda: no relevante acá (mismo motivo que
// en `relaySlicedDrain.test.ts`/`cederHiloEntreRebanadas.test.ts`).
jest.mock('@/src/sync/confianza/authorHealth', () => ({
  observeAuthor: jest.fn(async () => 'ok'),
  RECHAZAR_AUTORES_NO_VERIFICADOS: false,
}));
jest.mock('@/src/sync/confianza/authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));

// `snapshot`/`noticesFor` reales, envueltos en `jest.fn` sólo para poder medir
// cuántas veces y en qué orden se llaman — el comportamiento es el real.
jest.mock('@/src/services/syncNotices', () => {
  const actual = jest.requireActual('@/src/services/syncNotices') as typeof import('@/src/services/syncNotices');
  return { ...actual, snapshot: jest.fn(actual.snapshot), noticesFor: jest.fn(actual.noticesFor) };
});

// `announce` sí se reemplaza (no hay permisos de notificación nativos en
// test) — pero eso no toca nada de lo que esta suite mide.
jest.mock('@/src/services/notifications', () => ({ announce: jest.fn(async () => {}) }));

// `applyDelta` real, envuelto para poder ver CUÁNDO se llama respecto de
// `snapshot` — la prueba de orden real que B2 pedía.
jest.mock('../applyDelta', () => {
  const actual = jest.requireActual('../applyDelta') as typeof import('../applyDelta');
  return { ...actual, applyDelta: jest.fn(actual.applyDelta) };
});

import { drainNow } from '@/src/sync/motor/relayEngine';
import { publishToGroup, DRAIN_FETCH_LIMIT } from '@/src/sync/motor/relaySync';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useUserStore } from '@/src/store/userStore';
import { marcarPendienteDeDrenaje, limpiarPendienteDeDrenaje } from '@/src/sync/motor/pendingDrain';
import { deriveTopic } from '@/src/sync/nucleo/envelopeCrypto';
import { fromHex } from '@/src/sync/nucleo/hexBytes';
import type { Group, Expense, User } from '@/src/types/models';

const relayMock = jest.requireMock('../../supabase/relay') as {
  __buzones: Map<string, { seq: number; sender: string }[]>;
  __reset: () => void;
};
const mockSnapshot = jest.requireMock('@/src/services/syncNotices').snapshot as jest.Mock;
const mockNoticesFor = jest.requireMock('@/src/services/syncNotices').noticesFor as jest.Mock;
const mockAnnounce = jest.requireMock('@/src/services/notifications').announce as jest.Mock;
const mockApplyDelta = jest.requireMock('../applyDelta').applyDelta as jest.Mock;

function grupo(): Group {
  return {
    id: 'G', name: 'Grupo', memberIds: ['u1', 'u2'], currency: 'USD',
    // T-191 (V2b): el roster tiene que reflejar la misma membresía que
    // `memberIds` — con roster vacío, el merge de `groups` (T-182) recalcula
    // `memberIds` a `[]` y la rebanada `users` queda con una dependencia que
    // nunca se resuelve, dejando el drenaje sin completar nunca.
    miembros: { u1: { estado: 'in', at: 1 }, u2: { estado: 'in', at: 1 } },
    createdAt: 1, createdById: 'u1',
    updatedAt: 1_000, isDeleted: false,
  } as Group;
}

let gastoSeq = 0;
/** Gasto de OTRO usuario (u2) — es lo que hace que `noticesFor` real dispare
 *  un aviso al drenarlo (la regla 1 de T-010: lo propio nunca se avisa). */
function gastoDeOtro(): Expense {
  gastoSeq += 1;
  return {
    id: `e${gastoSeq}`, groupId: 'G', description: `Gasto ${gastoSeq}`, amount: 10,
    currency: 'USD', paidById: 'u2', splits: [{ userId: 'u2', amount: 10, isPaid: false }],
    splitMode: 'equal', category: 'other', date: 1, createdAt: 1, createdById: 'u2', updatedAt: 1_000, isDeleted: false,
  } as Expense;
}

/**
 * Publica como si fuera OTRO dispositivo (u2): siembra un gasto suyo en el
 * store, publica, y devuelve el store local a como estaba (vacío) — para que
 * `drainNow`, corriendo después como u1, lo vea llegar como NUEVO. Mismo
 * truco que `relayScope.test.ts` ("el receptor lo aplica sin perder lo
 * suyo"): este proceso hace de las DOS puntas, pero cada una ve sólo lo que
 * le corresponde.
 */
async function publicarGastoDeOtro(): Promise<void> {
  const antes = useExpenseStore.getState().expenses;
  useExpenseStore.setState({ expenses: [...antes, gastoDeOtro()] } as never);
  const r = await publishToGroup('G', 'u2', 'device-remoto');
  expect(r.ok).toBe(true);
  useExpenseStore.setState({ expenses: antes } as never); // el receptor no lo tenía
}

async function topicDeG(): Promise<string> {
  const rec = useGroupKeyStore.getState().getKey('G')!;
  return deriveTopic(fromHex(rec.key), rec.epoch);
}

beforeEach(() => {
  relayMock.__reset();
  useAuthStore.setState({ currentUser: { id: 'u1' } as User, user: { id: 'u1' } } as never);
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
  useGroupStore.setState({ groups: [grupo()] } as never);
  useExpenseStore.setState({ expenses: [] } as never);
  useUserStore.setState({ users: [{ id: 'u1', name: 'Uno' } as User] } as never);
  limpiarPendienteDeDrenaje('G');
  marcarPendienteDeDrenaje('G');
  mockSnapshot.mockClear();
  mockNoticesFor.mockClear();
  mockAnnounce.mockClear();
  mockApplyDelta.mockClear();
});

it('S5: buzón sin sobres nuevos -> NO se calcula snapshot() (drenaje real, buzón vacío)', async () => {
  const aplicado = await drainNow('G');

  expect(aplicado).toBe(0);
  expect(mockSnapshot).not.toHaveBeenCalled();
  expect(mockApplyDelta).not.toHaveBeenCalled();
  expect(mockAnnounce).not.toHaveBeenCalled();
});

it('S6: buzón con sobres -> snapshot() se llama UNA vez, ANTES del primer applyDelta (drenaje real)', async () => {
  // Otro usuario (u2) publica un gasto suyo en el buzón real del grupo.
  await publicarGastoDeOtro();

  const aplicado = await drainNow('G');

  expect(aplicado).toBeGreaterThan(0);
  expect(mockSnapshot).toHaveBeenCalledTimes(1);
  expect(mockApplyDelta).toHaveBeenCalled();
  // Orden real de invocación (no un mock que decide el orden él mismo): la
  // foto tiene que haber corrido ANTES que la primera aplicación.
  expect(mockSnapshot.mock.invocationCallOrder[0]!)
    .toBeLessThan(mockApplyDelta.mock.invocationCallOrder[0]!);
  expect(mockNoticesFor).toHaveBeenCalledTimes(1);
  expect(mockAnnounce).toHaveBeenCalled();
});

/**
 * S7 (tabla del plan): un usuario que ACTUALIZA — ya tiene un cursor
 * persistido de una bajada anterior, no arranca de cero — drena igual que
 * antes de este cambio: sólo lee lo nuevo desde su cursor, aplica y avisa.
 */
it('S7: usuario con cursor persistido viejo drena sólo lo nuevo, igual que siempre', async () => {
  // Primera tanda: alguien publica y este dispositivo la drena entera.
  await publicarGastoDeOtro();
  const primeraBajada = await drainNow('G');
  expect(primeraBajada).toBeGreaterThan(0);

  const topic = await topicDeG();
  const cursorTrasPrimera = (
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/src/sync/motor/relayEngine') as typeof import('@/src/sync/motor/relayEngine')
  ).readCursor(topic);
  expect(cursorTrasPrimera).toBeGreaterThan(0); // "cursor persistido viejo", no 0

  mockSnapshot.mockClear();
  mockApplyDelta.mockClear();
  mockAnnounce.mockClear();

  // Segunda tanda: más actividad remota, publicada DESPUÉS de que este
  // dispositivo ya tenía su cursor viejo guardado.
  await publicarGastoDeOtro();

  const segundaBajada = await drainNow('G');

  expect(segundaBajada).toBeGreaterThan(0); // drena lo nuevo, no se queda pegado
  expect(mockSnapshot).toHaveBeenCalledTimes(1); // perezosa, pero SÍ se llama porque hay sobres
  expect(mockApplyDelta).toHaveBeenCalled();
  expect(mockAnnounce).toHaveBeenCalled(); // sigue avisando igual que siempre

  const cursorTrasSegunda = (
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/src/sync/motor/relayEngine') as typeof import('@/src/sync/motor/relayEngine')
  ).readCursor(topic);
  expect(cursorTrasSegunda).toBeGreaterThan(cursorTrasPrimera); // avanzó, no se reprocesó desde 0
});

// Sanity de la propia página de fetch, para que el test no dependa de un
// número mágico si `DRAIN_FETCH_LIMIT` cambia algún día.
it('DRAIN_FETCH_LIMIT sigue siendo mayor que lo que este archivo publica por tanda', () => {
  expect(DRAIN_FETCH_LIMIT).toBeGreaterThan(1);
});
