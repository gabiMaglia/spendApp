import fs from 'fs';
import path from 'path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { applyDelta, type SyncDelta } from '../useSyncQR';
import { signCore } from '../recordSign';
import { toHex } from '../hexBytes';
import * as recordHealth from '../recordHealth';
import {
  recordStats, clearRecordHealth, reloadRecordHealth,
} from '../recordHealth';
import { clearVerdictCache } from '../verdictCache';
import { clearRatchet } from '../ratchet';
import { forgetAuthorKeys, reloadAuthorKeys, __resetAuthorSources } from '../authorKeys';
import { calculateBalances } from '@/src/algorithms/calculateBalances';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useRecurringStore } from '@/src/store/recurringStore';
import { useUserStore } from '@/src/store/userStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import type { User } from '@/src/types/models';

/**
 * **Dónde va el gate de S6, y qué NO hace.**
 *
 * Va en el **merge** y no en el transporte. Hay tres puertas de entrada de datos
 * de peers —el relay, el QR y el pairing P2P— y las tres desembocan en
 * `applyDelta`. Ponerlo en `drainGroup` dejaría dos bypass.
 *
 * Y la invariante que define S6: **nada deja de aplicarse por no verificar**
 * (R1 del PO). Al terminar S6 la app tiene que mostrar exactamente lo mismo que
 * antes. Si un test demuestra que un registro dejó de aplicarse, S6 está mal.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

const mockGetPeer = jest.fn();
jest.mock('../contactChannel', () => ({
  getPeer: (userId: string) => mockGetPeer(userId),
}));

jest.mock('../deviceKeys', () => ({
  fetchAccountKeys: jest.fn(async () => []),
}));

const RAIZ = path.resolve(__dirname, '../../..');

function par(seed: number) {
  const priv = new Uint8Array(32).fill(seed);
  return { priv: toHex(priv), pub: toHex(ed25519.getPublicKey(priv)) };
}

const ANA = par(41);
const IMPOSTOR = par(42);

const YO = 'yo';
const meta = { updatedAt: 9_000, isDeleted: false };

const gasto = (extra: Record<string, unknown> = {}) => ({
  id: 'e-1', groupId: 'g-1', description: 'Cena', amount: 10_000, currency: 'ARS',
  paidById: 'ana', splits: [{ userId: 'ana', amount: 5_000 }, { userId: YO, amount: 5_000 }],
  splitMode: 'equal', category: 'food', date: 1, createdAt: 1, createdById: 'ana',
  deletionVotes: [], rev: 1_000, ...meta, ...extra,
});

function delta(parcial: Partial<SyncDelta> = {}): SyncDelta {
  return {
    version: 1, fromUserId: 'ana', timestamp: 1,
    groups: [], expenses: [], payments: [], users: [],
    ...parcial,
  } as SyncDelta;
}

function limpiarStores(): void {
  useGroupStore.setState({ groups: [] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  useCommentStore.setState({ comments: [] });
  useRecurringStore.setState({ recurring: [] });
  useUserStore.setState({ users: [] });
  usePersonalStore.setState({ entries: [] });
  useGroupKeyStore.setState({ keys: [] });
}

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: YO } as User });
  limpiarStores();
  clearRecordHealth();
  clearVerdictCache();
  clearRatchet();
  forgetAuthorKeys();
  reloadAuthorKeys();
  __resetAuthorSources();
  mockGetPeer.mockReset();
  mockGetPeer.mockImplementation(() => ({ secret: 's', identityPublicKey: ANA.pub }));
});

describe('las TRES puertas desembocan en `applyDelta`', () => {
  /**
   * Guard estructural, no de comportamiento: lo que hay que impedir es que
   * mañana alguien agregue una puerta que mergee por su cuenta. El caso de
   * comportamiento —que `applyDelta` mide— lo cubren los describes de abajo, y
   * vale para las tres por construcción.
   */
  const PUERTAS = [
    { nombre: 'relay',   archivo: 'src/sync/relaySync.ts' },
    { nombre: 'QR',      archivo: 'app/sync/index.tsx' },
    { nombre: 'pairing', archivo: 'src/p2p/usePairingSession.ts' },
  ];

  const MERGES = [
    'mergeGroups', 'mergeExpenses', 'mergePayments', 'mergeUsers',
    'mergeRecurring', 'mergeComments', 'mergeEntries',
  ];

  it.each(PUERTAS)('$nombre aplica por `applyDelta`', ({ archivo }) => {
    const src = fs.readFileSync(path.join(RAIZ, archivo), 'utf8');
    expect(src).toContain('applyDelta(');
  });

  it.each(PUERTAS)('$nombre NO mergea por su cuenta (sería un bypass del gate)', ({ archivo }) => {
    const src = fs.readFileSync(path.join(RAIZ, archivo), 'utf8');
    for (const merge of MERGES) expect(src).not.toContain(`${merge}(`);
  });

  /**
   * `applyDelta` es SÍNCRONO y tiene que seguir siéndolo: es la restricción que
   * obliga a resolver contra caché local y a consultar el directorio fuera de
   * banda. Si devolviera una promesa, las tres puertas estarían mergeando sin
   * esperar y el orden dejaría de estar garantizado.
   */
  it('`applyDelta` sigue siendo síncrona: cero red adentro', () => {
    expect(applyDelta(delta(), YO)).toBeUndefined();
  });
});

describe('la invariante de S6: NADA deja de aplicarse por no verificar', () => {
  it('un gasto con la firma de un impostor entra igual y SUMA al balance', () => {
    const base = gasto();
    const falso = { ...base, ...signCore('expense', base as never, IMPOSTOR.priv) };

    applyDelta(delta({ expenses: [falso as never] }), YO);

    expect(useExpenseStore.getState().expenses.map(e => e.id)).toEqual(['e-1']);
    const saldos = calculateBalances(useExpenseStore.getState().expenses, ['ana', YO]);
    expect(saldos.find(b => b.userId === YO)?.amount).toBe(-5_000);
  });

  it('un gasto sin firma —lo que existe desde antes de T-041— entra igual', () => {
    const viejo = gasto({ id: 'e-viejo', rev: undefined });
    applyDelta(delta({ expenses: [viejo as never] }), YO);
    expect(useExpenseStore.getState().expenses.map(e => e.id)).toEqual(['e-viejo']);
  });

  it('las cinco entidades firmables siguen entrando enteras', () => {
    applyDelta(delta({
      groups: [{ id: 'g-1', name: 'Asado', memberIds: ['ana', YO], currency: 'ARS',
                 createdAt: 0, createdById: 'ana', deletionVotes: [], ...meta } as never],
      expenses: [gasto() as never],
      payments: [{ id: 'p-1', groupId: 'g-1', fromUserId: YO, toUserId: 'ana',
                   amount: 5_000, currency: 'ARS', date: 1, createdAt: 1,
                   createdById: YO, ...meta } as never],
      comments: [{ id: 'c-1', expenseId: 'e-1', authorId: 'ana', text: 'ok',
                   createdAt: 1, ...meta } as never],
      recurring: [{ id: 'r-1', groupId: 'g-1', description: 'Alquiler', amount: 1,
                    currency: 'ARS', paidById: 'ana', splitMode: 'equal',
                    memberIds: ['ana'], category: 'accommodation',
                    rule: { frequency: 'monthly', startDate: 0 }, isActive: true,
                    createdAt: 0, createdById: 'ana', ...meta } as never],
    }), YO);

    expect(useGroupStore.getState().groups).toHaveLength(1);
    expect(useExpenseStore.getState().expenses).toHaveLength(1);
    expect(usePaymentStore.getState().payments).toHaveLength(1);
    expect(useCommentStore.getState().comments).toHaveLength(1);
    expect(useRecurringStore.getState().recurring).toHaveLength(1);
  });

  /**
   * La medición no puede tener poder de veto ni por accidente. Si explota —un
   * storage que no abre, un dato imposible— el merge tiene que correr igual.
   *
   * Se rompe la medición DESDE ADENTRO y no una de sus fuentes: las fuentes ya
   * se degradan solas, así que romper una de ellas probaría la degradación de la
   * fuente y no que el merge sobrevive a lo inesperado.
   */
  it('una medición que explota no impide el merge', () => {
    const espia = jest.spyOn(recordHealth, 'observeRecords').mockImplementation(() => {
      throw new Error('boom');
    });
    try {
      const base = gasto();
      const firmado = { ...base, ...signCore('expense', base as never, ANA.priv) };

      expect(() => applyDelta(delta({ expenses: [firmado as never] }), YO)).not.toThrow();
      expect(useExpenseStore.getState().expenses).toHaveLength(1);
    } finally {
      espia.mockRestore();
    }
  });
});

describe('el gate mide, y mide lo que entra por cualquier puerta', () => {
  it('un gasto firmado por su autor cuenta `valida`', () => {
    const base = gasto();
    const firmado = { ...base, ...signCore('expense', base as never, ANA.priv) };

    applyDelta(delta({ expenses: [firmado as never] }), YO);
    expect(recordStats().valida).toBe(1);
  });

  /**
   * El descarte barato por `rev` es también lo que evita que la medición se
   * infle: el sobre trae el estado COMPLETO del grupo cada 20 s, así que sin él
   * los mismos registros se contarían una y otra vez.
   */
  it('el mismo delta dos veces no cuenta dos veces', () => {
    const base = gasto();
    const firmado = { ...base, ...signCore('expense', base as never, ANA.priv) };

    applyDelta(delta({ expenses: [firmado as never] }), YO);
    applyDelta(delta({ expenses: [firmado as never] }), YO);

    expect(recordStats().valida).toBe(1);
  });

  it('una revisión nueva del mismo gasto sí se vuelve a contar', () => {
    const uno = gasto();
    applyDelta(delta({ expenses: [{ ...uno, ...signCore('expense', uno as never, ANA.priv) } as never] }), YO);

    const dos = gasto({ amount: 20_000, rev: 2_000, updatedAt: 10_000 });
    applyDelta(delta({ expenses: [{ ...dos, ...signCore('expense', dos as never, ANA.priv) } as never] }), YO);

    expect(recordStats().valida).toBe(2);
  });

  it('la medición del merge también sobrevive al reinicio', () => {
    const base = gasto();
    applyDelta(delta({ expenses: [{ ...base, ...signCore('expense', base as never, ANA.priv) } as never] }), YO);

    reloadRecordHealth();
    expect(recordStats().valida).toBe(1);
  });
});
