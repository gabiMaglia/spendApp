/**
 * T-146 (TEC-01 + TEC-02). Dos agujeros del drenaje que perdían datos en
 * silencio:
 *  - una rebanada que tiraba en `applyDelta` se tragaba (`skipped++`) y el
 *    cursor avanzaba igual: no volvía a pedirse hasta que el emisor la
 *    republicara;
 *  - se leía UNA página de `DRAIN_FETCH_LIMIT` sobres sin iterar, pero la marca
 *    de «pendiente de drenaje» (T-089) se limpiaba como si se hubiera leído todo.
 */
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
    // Honra `since` exclusivo, `excludeSender` y `limit`, como el real.
    fetchSince: async (topic: string, since: number, excludeSender?: string, limit = 200) => {
      const lista = (buzones.get(topic) ?? [])
        .filter(e => e.seq > since && e.sender !== excludeSender)
        .slice(0, limit);
      return { ok: true, envelopes: lista, cursor: lista.length ? lista[lista.length - 1]!.seq : since };
    },
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
import { publishToGroup, drainGroup, DRAIN_FETCH_LIMIT } from '../relaySync';
import { olvidarFallosDeAplicacion, DRAIN_MAX_REINTENTOS } from '../drainFailures';
import { listErrors, clearErrors } from '@/src/services/errorLog';
import { manifestGapFor, clearManifestGaps } from '../manifestHealth';
import type { Group, Expense } from '@/src/types/models';

const relayMock = jest.requireMock('../relay') as { __reset: () => void; __buzones: Map<string, { seq: number; sender: string }[]> };
const { applyDelta } = jest.requireMock('../useSyncQR') as { applyDelta: jest.Mock };

const grupo = (): Group => ({
  id: 'G', name: 'Grupo', memberIds: ['u1'], currency: 'USD', createdAt: 1, createdById: 'u1',
  deletionVotes: [], updatedAt: 1_000, isDeleted: false,
} as Group);

const gasto = (id: string): Expense => ({
  id, groupId: 'G', description: 'x'.repeat(2_000), amount: 10, currency: 'USD', paidById: 'u1',
  splits: [{ userId: 'u1', amount: 10, isPaid: false }], splitMode: 'equal', category: 'other',
  date: 1, createdAt: 1, createdById: 'u1', deletionVotes: [], updatedAt: 1_000, isDeleted: false,
} as Expense);

/** Publica N gastos desde `device1` y deja el store vacío para que `device2` drene. */
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
  clearManifestGaps();
  clearErrors();
  olvidarFallosDeAplicacion();
  applyDelta.mockClear();
  applyDelta.mockImplementation(jest.requireActual('../useSyncQR').applyDelta);
  useAuthStore.setState({ currentUser: { id: 'u1' } } as never); // `readScoped` necesita usuario activo
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
});

describe('TEC-02 · paginación', () => {
  it('lee todas las páginas antes de decir que terminó', async () => {
    const sobres = await publicarDesdeOtroAparato(200); // ~7 rebanadas + 1 manifiesto
    expect(sobres).toBeGreaterThan(3);

    const r = await drainGroup('G', 'u1', 'device2', 0, { pageLimit: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.completo).toBe(true);
    expect(r.cursor).toBe(sobres);
    expect(useExpenseStore.getState().expenses).toHaveLength(200);
    expect(manifestGapFor('G')).toBeNull();
  });

  it('si el techo de páginas no alcanza, aplica lo leído, avanza el cursor y dice que NO terminó', async () => {
    const sobres = await publicarDesdeOtroAparato(200);

    const r = await drainGroup('G', 'u1', 'device2', 0, { pageLimit: 2, maxPages: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.completo).toBe(false);
    expect(r.cursor).toBe(4);                                   // 2 páginas × 2 sobres
    expect(r.cursor).toBeLessThan(sobres);
    expect(useExpenseStore.getState().expenses.length).toBeGreaterThan(0);
    expect(manifestGapFor('G')).toBeNull();                     // no se opina con página recortada
  });

  it('el límite por defecto sigue siendo 200', () => {
    expect(DRAIN_FETCH_LIMIT).toBe(200);
  });
});

describe('TEC-01 · una rebanada que falla al aplicarse', () => {
  it('no avanza el cursor por encima de ella y deja rastro', async () => {
    await publicarDesdeOtroAparato(200);
    // Falla la SEGUNDA rebanada de datos que se aplique.
    applyDelta
      .mockImplementationOnce(jest.requireActual('../useSyncQR').applyDelta)
      .mockImplementationOnce(() => { throw new Error('memberIds.filter is not a function'); });

    const r = await drainGroup('G', 'u1', 'device2', 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.completo).toBe(false);
    expect(r.cursor).toBe(1);            // la rebanada 2 (seq 2) queda por delante del cursor
    expect(r.applied).toBe(1);
    expect(listErrors()[0]!.message).toContain('seq=2');
  });

  it('la próxima vuelta la vuelve a pedir y, si ahora aplica, sigue de largo', async () => {
    const sobres = await publicarDesdeOtroAparato(200);
    applyDelta
      .mockImplementationOnce(jest.requireActual('../useSyncQR').applyDelta)
      .mockImplementationOnce(() => { throw new Error('transitorio'); });

    const primera = await drainGroup('G', 'u1', 'device2', 0);
    if (!primera.ok) throw new Error('primera falló');
    const segunda = await drainGroup('G', 'u1', 'device2', primera.cursor);
    expect(segunda.ok && segunda.completo).toBe(true);
    if (!segunda.ok) return;
    expect(segunda.cursor).toBe(sobres);
    expect(useExpenseStore.getState().expenses).toHaveLength(200);
  });

  it('agotados los reintentos, la deja atrás con rastro y sigue con el resto', async () => {
    const sobres = await publicarDesdeOtroAparato(200);
    // La rebanada con seq 2 falla SIEMPRE.
    applyDelta.mockImplementation((delta: unknown, uid: string) => {
      const real = jest.requireActual('../useSyncQR').applyDelta;
      const d = delta as { expenses: { id: string }[] };
      if (d.expenses.some(e => e.id === 'e000')) throw new Error('permanente'); // e000 vive en la 1.ª rebanada de expenses
      return real(delta, uid);
    });

    let r = await drainGroup('G', 'u1', 'device2', 0);
    for (let i = 1; i < DRAIN_MAX_REINTENTOS; i++) {
      expect(r.ok && !r.completo).toBe(true);
      r = await drainGroup('G', 'u1', 'device2', r.ok ? r.cursor : 0);
    }
    // Tercer intento: agotó → se deja atrás y el drenaje completa.
    r = await drainGroup('G', 'u1', 'device2', r.ok ? r.cursor : 0);
    expect(r.ok && r.completo).toBe(true);
    if (!r.ok) return;
    expect(r.cursor).toBe(sobres);
    expect(r.skipped).toBeGreaterThanOrEqual(1);
    expect(listErrors().filter(e => e.message.includes('permanente'))).toHaveLength(DRAIN_MAX_REINTENTOS);
    // Los gastos de las OTRAS rebanadas sí entraron.
    expect(useExpenseStore.getState().expenses.length).toBeGreaterThan(100);
    expect(useExpenseStore.getState().expenses.some(e => e.id === 'e000')).toBe(false);
  });
});
