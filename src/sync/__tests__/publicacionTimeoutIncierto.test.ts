/**
 * T-191, hallazgo del verifier (cuarta tanda) sobre el fix de M2: `withTimeout`
 * a secas NO cancela la request — sólo deja de ESPERARLA. Si el envío
 * "vencido" aterriza en el servidor DESPUÉS de que una publicación más nueva
 * ya mandó y confirmó su cubo, la compactación se queda con el contenido
 * VIEJO (quien llegó último gana) mientras el ledger local sigue creyendo el
 * digest NUEVO — una tercera publicación sin cambios locales nunca vuelve a
 * mandar ese cubo, y el recién llegado ve la versión vieja para siempre.
 *
 * Fix en dos partes (`relaySync.ts`):
 *  (a) `AbortSignal` real hasta `sendEnvelope`/`postgrest-js`: al vencer el
 *      timeout, se cancela la request de verdad.
 *  (b) Defensa aunque el abort no cancele nada (mock de este archivo: ignora
 *      el `signal` a propósito, para probar el peor caso): la promesa cruda
 *      del envío vencido se registra en la cola del topic
 *      (`registrarPendienteSinAsentar`), y el SIGUIENTE turno no arranca
 *      hasta que esa promesa se asienta — así que un envío que aterriza
 *      tarde no puede intercalarse ENTRE dos publicaciones, aunque el abort
 *      no haya surtido efecto.
 */
jest.mock('../relay', () => {
  const buzones = new Map<string, { seq: number; topic: string; payload: string; sender: string; compactable?: boolean; ckey?: string }[]>();
  let seq = 0;
  const llamadasPorCkey = new Map<string, number>();
  let colgarCkey: string | null = null;
  let sostenido: (() => void) | null = null;
  return {
    __buzones: buzones,
    __reset: () => { buzones.clear(); seq = 0; llamadasPorCkey.clear(); colgarCkey = null; sostenido = null; },
    __colgarProximoEnvioDe: (ckey: string) => { colgarCkey = ckey; },
    __liberarEnvioColgado: () => { sostenido?.(); },
    __llamadasA: (ckey: string) => llamadasPorCkey.get(ckey) ?? 0,
    isRelayConfigured: () => true,
    subscribeTopic: () => () => {},
    // A propósito IGNORA el `signal` (6to argumento) — simula el peor caso
    // (el abort no cancela nada, o llega demasiado tarde) para probar que
    // la defensa (b) alcanza sola.
    sendEnvelope: async (topic: string, payload: string, sender: string, compactable = false, ckey?: string) => {
      llamadasPorCkey.set(ckey ?? '', (llamadasPorCkey.get(ckey ?? '') ?? 0) + 1);
      if (ckey && ckey === colgarCkey) {
        colgarCkey = null;
        await new Promise<void>(resolve => { sostenido = resolve; });
      }
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

import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore, groupKeyBytes } from '@/src/store/groupKeyStore';
import { publishToGroup, drainGroup, PUBLICACION_TIMEOUT_MS } from '../relaySync';
import { manifestGapFor, clearManifestGaps } from '../manifestHealth';
import { deriveCkey } from '../slices';
import { prefijoDe } from '../relay/cubos';
import type { Group, Expense } from '@/src/types/models';

const relayMock = jest.requireMock('../relay') as {
  __reset: () => void;
  __colgarProximoEnvioDe: (ckey: string) => void;
  __liberarEnvioColgado: () => void;
  __llamadasA: (ckey: string) => number;
};

const grupo = (): Group => ({
  id: 'G', name: 'Grupo', memberIds: ['u1'], currency: 'USD', createdAt: 1, createdById: 'u1',
  miembros: { u1: { estado: 'in', at: 1 } }, updatedAt: 1_000, isDeleted: false,
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

it('un envío vencido que aterriza tarde (abort ignorado) no pisa una publicación más nueva', async () => {
  jest.useFakeTimers();
  try {
    const key = groupKeyBytes('G')!;
    // 'e1' no es un UUID: el cubo real usa el prefijo de `sha256('e1')`
    // (`prefijoDe`/`cubosDe`, `relay/cubos.ts`) — a profundidad 1 por
    // defecto (un solo registro, muy por debajo de SPLIT_BYTES).
    const prefijo = await prefijoDe('e1', 1);
    const ckeyExpenses = await deriveCkey(key, 'expenses', prefijo);
    relayMock.__colgarProximoEnvioDe(ckeyExpenses);

    useExpenseStore.setState({ expenses: [gasto('e1', 'v1', 1_000)] } as never);
    const p1 = publishToGroup('G', 'u1', 'device1'); // su cubo de expenses queda colgado

    for (let i = 0; i < 10; i++) await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(PUBLICACION_TIMEOUT_MS + 1_000);
    const r1 = await p1;
    expect(r1.ok).toBe(false); // el timeout lo corta del lado de quien llama

    // Se dispara la SIGUIENTE publicación (v2) SIN esperar a que termine —
    // con la defensa (b), no debería completar todavía: el envío colgado de
    // P1 sigue sin asentarse.
    useExpenseStore.setState({ expenses: [gasto('e1', 'v2', 2_000)] } as never);
    const p2 = publishToGroup('G', 'u1', 'device1');

    let p2Resuelto = false;
    void p2.then(() => { p2Resuelto = true; });
    await jest.advanceTimersByTimeAsync(50);
    expect(p2Resuelto).toBe(false); // P2 sigue esperando a que P1 se asiente
    expect(relayMock.__llamadasA(ckeyExpenses)).toBe(1); // sólo el intento colgado de P1

    // Recién ahora "aterriza" el envío viejo de P1 (con v1) — simulando que
    // el abort no llegó a tiempo o el servidor ya lo había recibido.
    relayMock.__liberarEnvioColgado();
    for (let i = 0; i < 10; i++) await jest.advanceTimersByTimeAsync(0);
    const r2 = await p2;
    expect(r2.ok).toBe(true);

    // El cubo de expenses se mandó DE NUEVO recién cuando P2 arrancó de
    // verdad (después de que P1 se asentó) — nunca se intercaló entre medio.
    expect(relayMock.__llamadasA(ckeyExpenses)).toBe(2);
  } finally {
    jest.useRealTimers();
  }

  // `drainGroup` usa `cederHilo` real (timers reales) — corre AFUERA del
  // bloque de fake timers a propósito.
  useExpenseStore.setState({ expenses: [] } as never);
  const rDrain = await drainGroup('G', 'u1', 'devNuevo', 0);
  expect(rDrain.ok).toBe(true);
  expect(manifestGapFor('G')).toBeNull();
  // El estado final es el MÁS NUEVO (v2), no el que aterrizó tarde (v1).
  expect(useExpenseStore.getState().expenses.find(e => e.id === 'e1')?.description).toBe('v2');
});
