/**
 * Verifier ciego (rechazo de perf/ola-b), B3: T-157b abrió una ventana nueva.
 * Entre la pasada 1 (colección: abrir/descifrar cada sobre, cediendo el hilo
 * entre aperturas) y la pasada 2 (aplicación) puede pasar un logout, un wipe
 * de cuenta o un cambio de clave de grupo — y la pasada de aplicación no
 * volvía a chequear nada: aplicaba con la caché que tenía FRÍA cuando arrancó
 * la página, sobre stores que mientras tanto pueden haberse vaciado. El
 * resultado es que datos de la cuenta ANTERIOR reaparecen en stores recién
 * limpiados por el logout/wipe.
 *
 * El arreglo: justo antes de aplicar (antes de `antesDeAplicar`/el primer
 * `applyDelta` de la página), `drainGroup` vuelve a chequear que el usuario
 * activo sigue siendo el que arrancó el drenaje y que `sigueSiendoLaClave`
 * sigue valiendo. Si algo cambió, aborta esa página sin aplicar nada y sin
 * mover el cursor — igual que ya hacía el chequeo de clave de ANTES de abrir
 * el primer sobre (T-136 · D-1), sólo que ahora también cubre el hueco que
 * `cederHilo` abre DESPUÉS de esa primera comprobación.
 */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

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

jest.mock('../authorHealth', () => ({
  observeAuthor: jest.fn(async () => 'ok'),
  RECHAZAR_AUTORES_NO_VERIFICADOS: false,
}));
jest.mock('../authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));

/**
 * `cederHilo` real (sigue cediendo de verdad), pero la PRIMERA vez que se
 * llama simula el logout que se coló en el hueco: cambia el usuario activo
 * ANTES de resolver. Es la forma más fiel de reproducir "algo pasó durante
 * el hueco que cederHilo abre" sin tocar el mecanismo de ceder en sí.
 *
 * `require` perezoso adentro de la función (no en el top del factory): así
 * no importa el orden de inicialización de módulos — se resuelve recién
 * cuando el drenaje real invoca `cederHilo`.
 */
jest.mock('../cederHilo', () => {
  const actual = jest.requireActual('../cederHilo') as typeof import('../cederHilo');
  let primeraVez = true;
  return {
    cederHilo: async () => {
      if (primeraVez) {
        primeraVez = false;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useAuthStore } = require('@/src/store/authStore') as typeof import('@/src/store/authStore');
        useAuthStore.setState({ currentUser: { id: 'otro-usuario' } as never });
      }
      return actual.cederHilo();
    },
    __resetPrimeraVez: () => { primeraVez = true; },
  };
});

import { publishToGroup, drainGroup } from '../relaySync';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useUserStore } from '@/src/store/userStore';
import type { Group, Expense, User } from '@/src/types/models';

const relayMock = jest.requireMock('../relay') as {
  __buzones: Map<string, { seq: number }[]>;
  __reset: () => void;
};
const cederHiloMock = jest.requireMock('../cederHilo') as { __resetPrimeraVez: () => void };

function grupo(): Group {
  return {
    id: 'G', name: 'Grupo', memberIds: ['u1', 'u2'], currency: 'USD',
    createdAt: 1, createdById: 'u1', deletionVotes: [],
    updatedAt: 1_000, isDeleted: false,
  } as Group;
}

/** Dos gastos: entre "groups" + "expenses" + manifiesto hay de sobra para que
 *  la pasada de colección llame a `cederHilo` al menos una vez. */
function gastos(): Expense[] {
  return [0, 1].map(i => ({
    id: `e${i}`, groupId: 'G', description: `Gasto ${i}`, amount: 10, currency: 'USD',
    paidById: 'u2', splits: [{ userId: 'u2', amount: 10, isPaid: false }], splitMode: 'equal',
    category: 'other', date: 1, createdAt: 1, createdById: 'u2', deletionVotes: [],
    updatedAt: 1_000, isDeleted: false,
  } as Expense));
}

beforeEach(() => {
  relayMock.__reset();
  cederHiloMock.__resetPrimeraVez();
  useAuthStore.setState({ currentUser: { id: 'u1' } as User });
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
  useGroupStore.setState({ groups: [grupo()] } as never);
  useExpenseStore.setState({ expenses: [] } as never);
  useUserStore.setState({ users: [{ id: 'u1', name: 'Uno' } as User] } as never);
});

it('B3: un logout durante el hueco de cederHilo aborta la página — nada se aplica, el cursor no avanza', async () => {
  // u2 (otro dispositivo) publica dos gastos — bastan para que la pasada de
  // colección tenga más de un sobre y ceda el hilo al menos una vez.
  useExpenseStore.setState({ expenses: gastos() } as never);
  const publicado = await publishToGroup('G', 'u2', 'device-remoto');
  expect(publicado.ok).toBe(true);
  useExpenseStore.setState({ expenses: [] } as never); // el receptor (u1) todavía no los tiene

  // Drena como u1 — el mock de `cederHilo` va a cambiar el usuario activo a
  // "otro-usuario" a mitad de la colección, ANTES de que se llegue a aplicar.
  const r = await drainGroup('G', 'u1', 'device-local', 0);

  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.reason).toBe('key_changed');

  // Nada de lo publicado se aplicó: el store sigue vacío.
  expect(useExpenseStore.getState().expenses).toEqual([]);
});
