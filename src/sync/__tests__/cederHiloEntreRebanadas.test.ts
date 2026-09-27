/**
 * T-157b: con ADR-007 una publicación o un drenaje puede procesar varias
 * rebanadas seguidas —cada una con su propio sellado/firma o apertura/
 * descifrado— todo en una sola vuelta síncrona de JS. En un dispositivo de
 * gama baja eso alcanza a trabar la UI el tiempo que tarda la ráfaga entera.
 *
 * `cederHilo()` (`../cederHilo`, un `setTimeout(0)` envuelto en promesa) se
 * intercala ENTRE piezas — nunca antes de la primera — para darle al event
 * loop la chance de atender un tap o un render de por medio.
 *
 * Este archivo prueba, con un buzón real en memoria (mismo patrón que
 * `relaySlicedPublish.test.ts`/`relaySlicedDrain.test.ts`):
 *  1. `publishToGroup` con K piezas (rebanadas + manifiesto) llama a
 *     `cederHilo` K-1 veces, y lo que llega al buzón es idéntico a lo que ya
 *     probaban esos otros archivos (mismo orden, mismo contenido).
 *  2. La pasada de APERTURA de `drainGroup` (abrir/descifrar cada sobre
 *     recibido) llama a `cederHilo` K-1 veces sobre esa misma página — nunca
 *     entre aplicaciones (la pasada 2), que tiene que correr de un tirón por
 *     el orden load-bearing de `SLICED_FIELDS`.
 */
jest.mock('../cederHilo', () => ({ cederHilo: jest.fn(async () => {}) }));

jest.mock('../relay', () => {
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

// Diagnóstico fuera de banda, no relevante para lo que este archivo verifica
// (mismo motivo que en `relaySlicedDrain.test.ts`).
jest.mock('../authorHealth', () => ({
  observeAuthor: jest.fn(async () => 'ok'),
  RECHAZAR_AUTORES_NO_VERIFICADOS: false,
}));
jest.mock('../authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));

import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore, groupKeyBytes } from '@/src/store/groupKeyStore';
import { useUserStore } from '@/src/store/userStore';
import { publishToGroup, drainGroup } from '../relaySync';
import { openEnvelope } from '../envelopeCrypto';
import { verifyEnvelope } from '../envelopeSign';
import { isManifest } from '../manifest';
import type { Group, Expense, User } from '@/src/types/models';

const cederHiloMock = jest.requireMock('../cederHilo').cederHilo as jest.Mock;
const relayMock = jest.requireMock('../relay') as {
  __buzones: Map<string, { seq: number; ckey?: string; compactable?: boolean; payload: string }[]>;
  __reset: () => void;
};

function grupo(): Group {
  return {
    id: 'G', name: 'Grupo', memberIds: ['u1'], currency: 'USD',
    miembros: {}, // T-182: placeholder de tipo (fixture no ejercita el roster)
    createdAt: 1, createdById: 'u1', deletionVotes: [],
    updatedAt: 1_000, isDeleted: false,
  } as Group;
}

function gasto(id: string): Expense {
  return {
    id, groupId: 'G', description: 'x'.repeat(2_000), amount: 10, currency: 'USD',
    paidById: 'u1', splits: [{ userId: 'u1', amount: 10, isPaid: false }], splitMode: 'equal',
    category: 'other', date: 1, createdAt: 1, createdById: 'u1', deletionVotes: [],
    updatedAt: 1_000, isDeleted: false,
  } as Expense;
}

beforeEach(() => {
  relayMock.__reset();
  // `mockReset` (no sólo `mockClear`): un test de este archivo cambia la
  // implementación a la REAL para comparar contenido — sin resetearla
  // también, esa implementación se filtraría a los tests siguientes.
  cederHiloMock.mockReset().mockImplementation(async () => {});
  useAuthStore.setState({ user: { id: 'u1' } } as never);
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
  useGroupStore.setState({ groups: [grupo()] } as never);
  useUserStore.setState({ users: [{ id: 'u1', name: 'Uno' } as User] } as never);
  const muchosGastos = Array.from({ length: 200 }, (_, i) => gasto(`e${i}`));
  useExpenseStore.setState({ expenses: muchosGastos } as never);
});

it('publishToGroup cede el hilo K-1 veces (K = rebanadas + manifiesto), nunca antes de la primera', async () => {
  const result = await publishToGroup('G', 'u1', 'device1');
  expect(result.ok).toBe(true);

  const [topic] = [...relayMock.__buzones.keys()];
  const sobres = relayMock.__buzones.get(topic)!;
  expect(sobres.length).toBeGreaterThan(1); // K > 1, si no el test no prueba nada

  expect(cederHiloMock).toHaveBeenCalledTimes(sobres.length - 1);
});

/** Descifra todos los sobres del buzón y devuelve, EN ORDEN, los ids de gasto
 *  de cada rebanada `expenses` que encuentra — para comparar contenido, no
 *  sólo cantidad de sobres. */
function idsDeGastosEnviados(): string[] {
  const key = groupKeyBytes('G')!;
  const ids: string[] = [];
  for (const sobres of relayMock.__buzones.values()) {
    for (const sobre of sobres) {
      const firmado = verifyEnvelope(sobre.payload);
      if (!firmado) continue;
      const plain = openEnvelope(key, firmado.sealed);
      if (!plain) continue;
      let content: unknown;
      try { content = JSON.parse(plain); } catch { continue; }
      if (!content || typeof content !== 'object' || isManifest(content)) continue;
      const expenses = (content as { expenses?: { id: string }[] }).expenses;
      if (Array.isArray(expenses)) ids.push(...expenses.map(e => e.id));
    }
  }
  return ids;
}

/**
 * Observación del verificador ciego: ceder el hilo entre rebanadas es un
 * detalle de CUÁNDO se manda cada sobre, nunca de QUÉ se manda. Se publica
 * dos veces con el MISMO estado (`beforeEach` resiembra 200 gastos idénticos
 * en cada test) — una con `cederHilo` mockeado a no-op (como el resto de este
 * archivo) y otra con la implementación REAL (timer real de verdad,
 * `setTimeout(0)`, sin fake timers en este archivo así que resuelve solo) — y
 * se compara el contenido descifrado, no sólo la cantidad de sobres.
 */
it('el contenido publicado es idéntico ceda o no el hilo entre rebanadas', async () => {
  await publishToGroup('G', 'u1', 'device1'); // cederHilo mockeado a no-op (default del archivo)
  const idsConMock = idsDeGastosEnviados();
  expect(idsConMock.length).toBe(200); // sanity: se publicaron los 200 gastos sembrados

  relayMock.__reset();
  cederHiloMock.mockImplementation(jest.requireActual('../cederHilo').cederHilo as () => Promise<void>);

  await publishToGroup('G', 'u1', 'device1'); // ahora cederHilo REAL
  const idsConCederHiloReal = idsDeGastosEnviados();

  expect(idsConCederHiloReal).toEqual(idsConMock); // mismo contenido, mismo orden
});

it('la apertura de drainGroup cede el hilo K-1 veces sobre la página, nunca entre aplicaciones', async () => {
  await publishToGroup('G', 'u1', 'device1');
  cederHiloMock.mockClear();

  // Drena como OTRO dispositivo/usuario: sender 'device1' no se excluye.
  const r = await drainGroup('G', 'u2', 'device2', 0);
  expect(r.ok).toBe(true);
  if (!r.ok) return;

  const [topic] = [...relayMock.__buzones.keys()];
  const sobres = relayMock.__buzones.get(topic)!;

  expect(cederHiloMock).toHaveBeenCalledTimes(sobres.length - 1);
  // Se aplicó todo lo que había que aplicar: el orden de aplicación (pasada 2)
  // no se tocó, así que sigue completando el drenaje entero.
  expect(r.completo).toBe(true);
  expect(r.applied).toBeGreaterThan(0);
});
