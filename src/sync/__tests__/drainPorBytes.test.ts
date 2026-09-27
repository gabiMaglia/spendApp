/**
 * T-147 (D4/H1) · el corte de página ahora puede venir por BYTES, no sólo por
 * cantidad de filas: `fetch_since` (011a) puede devolver menos de `limit`
 * filas y aun así avisar `more = true` (una página de 4 MB con sobres
 * grandes). El drenaje tiene que confiar en `more` cuando está presente, y
 * sólo caer a "página corta = fondo" cuando el servidor es viejo y no lo manda.
 */
jest.mock('../relay', () => {
  const buzones = new Map<string, { seq: number; topic: string; payload: string; sender: string; compactable?: boolean; ckey?: string }[]>();
  let seq = 0;
  let modo: 'nuevo' | 'viejo' = 'nuevo';
  return {
    __buzones: buzones,
    __reset: () => { buzones.clear(); seq = 0; modo = 'nuevo'; },
    __setModo: (m: 'nuevo' | 'viejo') => { modo = m; },
    isRelayConfigured: () => true,
    subscribeTopic: () => () => {},
    sendEnvelope: async (topic: string, payload: string, sender: string, compactable = false, ckey?: string) => {
      const lista = buzones.get(topic) ?? [];
      lista.push({ seq: ++seq, topic, payload, sender, compactable, ckey });
      buzones.set(topic, lista);
      return { ok: true, seq };
    },
    // Una página de UN sobre por vez (simula el tope de 4 MB), con `more`
    // explícito — a diferencia del mock "viejo" (drainPaginado.test.ts), que
    // no manda `more` y deja `pageLimit` como único corte.
    fetchSince: jest.fn(async (topic: string, since: number, excludeSender?: string, limit = 200) => {
      const restantes = (buzones.get(topic) ?? []).filter(e => e.seq > since && e.sender !== excludeSender);
      if (modo === 'viejo') {
        const pagina = restantes.slice(0, limit);
        return { ok: true, envelopes: pagina, cursor: pagina.length ? pagina[pagina.length - 1]!.seq : since };
      }
      const pagina = restantes.slice(0, 1);
      const cursor = pagina.length ? pagina[pagina.length - 1]!.seq : since;
      return { ok: true, envelopes: pagina, cursor, more: restantes.length > pagina.length };
    }),
    deleteMyEnvelopes: async () => ({ ok: true }),
  };
});
jest.mock('../authorHealth', () => ({ observeAuthor: jest.fn(async () => 'ok'), RECHAZAR_AUTORES_NO_VERIFICADOS: false }));
jest.mock('../authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));
jest.mock('../useSyncQR', () => {
  const real = jest.requireActual('../useSyncQR');
  return { ...real, applyDelta: jest.fn(real.applyDelta) };
});

import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { publishToGroup, drainGroup } from '../relaySync';
import { olvidarFallosDeAplicacion } from '../drainFailures';
import { listErrors, clearErrors } from '@/src/services/errorLog';
import { clearManifestGaps } from '../manifestHealth';
import type { Group, Expense } from '@/src/types/models';

const relayMock = jest.requireMock('../relay') as {
  __reset: () => void;
  __setModo: (m: 'nuevo' | 'viejo') => void;
  __buzones: Map<string, { seq: number; sender: string }[]>;
  fetchSince: jest.Mock;
};
const { applyDelta } = jest.requireMock('../useSyncQR') as { applyDelta: jest.Mock };
const fetchSinceMock = relayMock.fetchSince;

const grupo = (): Group => ({
  id: 'G', name: 'Grupo', memberIds: ['u1', 'u2'], currency: 'USD', createdAt: 1, createdById: 'u1',
  miembros: {}, // T-182: placeholder de tipo (fixture no ejercita el roster)
  deletionVotes: [], updatedAt: 1_000, isDeleted: false,
} as Group);

const gasto = (id: string): Expense => ({
  id, groupId: 'G', description: 'Cena', amount: 10, currency: 'USD', paidById: 'u1',
  splits: [{ userId: 'u1', amount: 10, isPaid: false }], splitMode: 'equal', category: 'other',
  date: 1, createdAt: 1, createdById: 'u1', deletionVotes: [], updatedAt: 1_000, isDeleted: false,
} as Expense);

async function publicarDesdeOtroAparato(n: number): Promise<number> {
  useGroupStore.setState({ groups: [grupo()] } as never);
  useExpenseStore.setState({ expenses: Array.from({ length: n }, (_, i) => gasto(`e${String(i).padStart(3, '0')}`)) } as never);
  await publishToGroup('G', 'u1', 'device1');
  const sobres = relayMock.__buzones.values().next().value!.length;
  useExpenseStore.setState({ expenses: [] } as never);
  useGroupStore.setState({ groups: [] } as never);
  return sobres;
}

beforeEach(() => {
  relayMock.__reset();
  fetchSinceMock.mockClear();
  clearManifestGaps();
  clearErrors();
  olvidarFallosDeAplicacion();
  applyDelta.mockClear();
  applyDelta.mockImplementation(jest.requireActual('../useSyncQR').applyDelta);
  useAuthStore.setState({ currentUser: { id: 'u2' } } as never);
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
});

describe('drenaje por tope de bytes (more)', () => {
  it('sigue leyendo mientras more = true aunque la página tenga menos filas que el límite', async () => {
    const sobres = await publicarDesdeOtroAparato(3);
    const r = await drainGroup('G', 'u2', 'device2', 0);
    expect(r).toMatchObject({ ok: true, completo: true });
    // `more` peek-ahead: `fetch_since` ya sabe en la ÚLTIMA página con datos si
    // queda algo detrás (candidatos con `limit + 1`), así que no hace falta una
    // vuelta extra vacía para confirmarlo — una llamada por sobre alcanza.
    expect(fetchSinceMock).toHaveBeenCalledTimes(sobres);
    expect(useExpenseStore.getState().expenses).toHaveLength(3);
  });

  it('sin more (servidor viejo) conserva la regla de siempre: página corta = fondo', async () => {
    relayMock.__setModo('viejo');
    await publicarDesdeOtroAparato(3);
    const r = await drainGroup('G', 'u2', 'device2', 0);
    expect(r).toMatchObject({ ok: true, completo: true });
    expect(fetchSinceMock).toHaveBeenCalledTimes(1);
  });
});
