/**
 * M3 (verifier, tercera tanda) — carrera entre `drainNow` en vuelo y un
 * restore (`applyBackup`).
 *
 * `applyBackup` (T-191 hallazgo V1, `backup.ts:178`) llama a
 * `marcarConTopic`, que es `void` async: resuelve en un microtask/tick
 * posterior, no en el mismo turno síncrono. Si un `drainNow` YA estaba en
 * vuelo (esperando su `fetchSince`) cuando el restore corre, ese `drainNow`
 * sigue viviendo con la clave/foto de ANTES del restore — y cuando por fin
 * su red resuelve, escribe un cursor alto (basado en datos de antes del
 * restore) y limpia la marca de "pendiente de drenaje" que `marcarConTopic`
 * acababa de poner, dejando el reset del restore sin efecto.
 *
 * Fix: una "generación" por grupo en `pendingDrain.ts`, que sube cada vez
 * que se marca pendiente de drenaje. `drainNow` la lee al ARRANCAR y la
 * vuelve a comparar antes de escribir el cursor / limpiar la marca — si
 * cambió mientras esperaba la red, este drenaje es de un mundo que ya no
 * existe y no toca nada.
 */
jest.mock('../relay', () => {
  const buzones = new Map<string, { seq: number; topic: string; payload: string; sender: string; ckey?: string }[]>();
  let seq = 0;
  let gate: (() => Promise<void>) | null = null;
  return {
    __buzones: buzones,
    __reset: () => { buzones.clear(); seq = 0; gate = null; },
    __setGate: (g: (() => Promise<void>) | null) => { gate = g; },
    __push: (topic: string, payload: string, sender: string, ckey?: string) => {
      const lista = (buzones.get(topic) ?? []).filter(e => !(e.sender === sender && e.ckey === ckey));
      lista.push({ seq: ++seq, topic, payload, sender, ckey });
      buzones.set(topic, lista);
      return lista[lista.length - 1]!.seq;
    },
    isRelayConfigured: () => true,
    subscribeTopic: () => () => {},
    sendEnvelope: async () => ({ ok: true, seq: ++seq }),
    fetchSince: async (topic: string, since: number, excludeSender?: string, limit = 200) => {
      if (gate) await gate();
      const lista = (buzones.get(topic) ?? []).filter(e => e.seq > since && e.sender !== excludeSender).slice(0, limit);
      return { ok: true, envelopes: lista, cursor: lista.length ? lista[lista.length - 1]!.seq : since, more: lista.length === limit };
    },
    deleteMyEnvelopes: async () => ({ ok: true }),
  };
});
jest.mock('../authorHealth', () => ({ observeAuthor: jest.fn(async () => 'ok'), RECHAZAR_AUTORES_NO_VERIFICADOS: false }));
jest.mock('../authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));
// `relayEngine.ts` real arrastra toda la cadena de arranque de sync
// (sesión, invites, deviceKeys, relayQueue...) — acá sólo hace falta
// `olvidarCursor`, que `marcarPendienteDeDrenaje` pide con `require()`
// perezoso para evitar el ciclo.
jest.mock('../relayEngine', () => ({
  olvidarCursor: jest.requireActual('../relay/cursor').olvidarCursor,
}));

import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore, groupKeyBytes } from '@/src/store/groupKeyStore';
import { drainNow } from '../relay/drain';
import { readCursor } from '../relay/cursor';
import { estaPendienteDeDrenaje } from '../pendingDrain';
import { deriveTopic, sealEnvelope } from '../envelopeCrypto';
import { signEnvelope } from '../envelopeSign';
import { ensureIdentity } from '@/src/store/identityStore';
import { deriveCkey } from '../slices';
import { buildManifest } from '../manifest';
import { applyBackup, BACKUP_FORMAT, BACKUP_VERSION, type BackupFile } from '@/src/services/backup';
import type { Group, Expense } from '@/src/types/models';

const relayMock = jest.requireMock('../relay') as {
  __reset: () => void;
  __setGate: (g: (() => Promise<void>) | null) => void;
  __push: (topic: string, payload: string, sender: string, ckey?: string) => number;
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

async function topicDe(): Promise<string> {
  const record = useGroupKeyStore.getState().getKey('G')!;
  return deriveTopic(groupKeyBytes('G')!, record.epoch);
}

function empujar(topic: string, delta: unknown, sender: string, ckey: string): number {
  const key = groupKeyBytes('G')!;
  const sealed = sealEnvelope(key, JSON.stringify(delta));
  const firmado = signEnvelope(sealed, ensureIdentity().privateKey);
  return relayMock.__push(topic, firmado, sender, ckey);
}

function envolverCrudo(campo: string, registros: unknown[]): Record<string, unknown> {
  return {
    version: 1, featureVersion: 2, fromUserId: 'quien-firma', timestamp: 0,
    groups: [], expenses: [], payments: [], users: [],
    [campo]: registros,
  };
}

function backupVacio(): BackupFile {
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: Date.now(),
    groups: [grupo()], expenses: [], payments: [], users: [],
    personalEntries: [], personalBudget: { currency: 'ARS', monthlyAmount: 0, includeOwedToMe: false },
    recurring: [], comments: [],
  };
}

beforeEach(() => {
  relayMock.__reset();
  useAuthStore.setState({ currentUser: { id: 'u1' } } as never);
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
  useGroupStore.setState({ groups: [grupo()] } as never);
  useExpenseStore.setState({ expenses: [] } as never);
});

it('M3: un restore que corre MIENTRAS drainNow está en vuelo no pierde su reset — el cursor queda en 0 y la marca puesta', async () => {
  const topic = await topicDe();
  const key = groupKeyBytes('G')!;
  const E1 = '11111111-1111-4111-8111-111111111111';
  const k1 = await deriveCkey(key, 'expenses', '1');
  const km = await deriveCkey(key, 'manifest', 'unica');
  const j1 = envolverCrudo('expenses', [gasto(E1)]);
  empujar(topic, j1, 'devA', k1);
  empujar(topic, await buildManifest([{ ckey: k1, json: JSON.stringify(j1) }]), 'devA', km);

  // El fetchSince de este drenaje queda EN VUELO hasta que se libera a mano.
  let liberar: (() => void) | undefined;
  relayMock.__setGate(() => new Promise<void>(resolve => { liberar = resolve; }));

  const drenajeEnVuelo = drainNow('G');
  // Deja que drainNow arranque y quede esperando el gate.
  await new Promise(resolve => setTimeout(resolve, 5));

  // El restore corre MIENTRAS el drenaje de arriba sigue esperando su red.
  applyBackup(backupVacio());
  // `marcarConTopic` es async (`void`) — deja que su propia cadena corra.
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(estaPendienteDeDrenaje('G')).toBe(true); // el restore ya marcó pendiente
  expect(readCursor(topic)).toBe(0); // y ya reseteó el cursor

  // Se libera el drenaje viejo: su red por fin resuelve, con datos de ANTES
  // del restore.
  relayMock.__setGate(null);
  liberar?.();
  await drenajeEnVuelo;

  // El drenaje viejo NO debe pisar lo que el restore acaba de poner.
  expect(readCursor(topic)).toBe(0);
  expect(estaPendienteDeDrenaje('G')).toBe(true);
});
