/**
 * T-147 (D4/H1/H6) · publicar y leer por RPC, con compatibilidad F2: el
 * cliente nuevo cae al camino viejo SÓLO cuando la RPC no existe (servidor sin
 * 011a). Un error de red NUNCA cae al fallback — ensuciaría el criterio de
 * corte (0 GET directos).
 *
 * ⚠️ Mismo esqueleto de env + `resetModules` que `relayPrenda.test.ts`.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://prueba.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-de-prueba';

type Err = { code?: string; message: string } | null;
let rpcResp: Record<string, { data: unknown; error: Err }> = {};
const mockRpc = jest.fn(async (fn: string) => rpcResp[fn] ?? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
let insertErr: Err = null;
let selectRows: unknown[] = [];
let selectErr: Err = null;
const mockInsert = jest.fn(() => ({ select: () => ({ single: async () => (insertErr ? { data: null, error: insertErr } : { data: { seq: 7, created_at: new Date().toISOString() }, error: null }) }) }));
const mockSelectChain: Record<string, unknown> = {};
for (const m of ['select', 'eq', 'gt', 'order', 'limit', 'neq']) mockSelectChain[m] = jest.fn(() => mockSelectChain);
(mockSelectChain as { then: unknown }).then = (ok: (v: unknown) => void) => ok({ data: selectErr ? null : selectRows, error: selectErr });
const mockFrom = jest.fn(() => ({ insert: mockInsert, ...mockSelectChain }));
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ rpc: mockRpc, from: mockFrom, auth: { getSession: async () => ({ data: { session: null } }) } })),
}));

let relay: typeof import('../relay');
afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});
beforeEach(() => {
  jest.resetModules();
  mockRpc.mockClear();
  mockInsert.mockClear();
  mockFrom.mockClear();
  rpcResp = {};
  insertErr = null;
  selectRows = [];
  selectErr = null;
  relay = require('../relay');
});

describe('sendEnvelope por RPC (H1)', () => {
  it('publica por publish_envelope y devuelve el seq', async () => {
    rpcResp.publish_envelope = { data: [{ seq: 42, created_at: new Date().toISOString() }], error: null };
    await expect(relay.sendEnvelope('t', 'p', 'd', true, 'k')).resolves.toEqual({ ok: true, seq: 42 });
    expect(mockRpc).toHaveBeenCalledWith('publish_envelope', expect.objectContaining({ p_topic: 't', p_payload: 'p', p_sender: 'd', p_compactable: true, p_ckey: 'k' }));
    expect(mockInsert).not.toHaveBeenCalled();
  });
  it('servidor sin 011a: cae al insert y lo recuerda', async () => {
    await expect(relay.sendEnvelope('t', 'p', 'd')).resolves.toEqual({ ok: true, seq: 7 });
    await relay.sendEnvelope('t', 'p', 'd');
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });
  it('cuota → rate_limited, sin fallback', async () => {
    rpcResp.publish_envelope = { data: null, error: { code: 'PT429', message: 'relay_quota_exceeded' } };
    await expect(relay.sendEnvelope('t', 'p', 'd')).resolves.toMatchObject({ ok: false, reason: 'rate_limited' });
    expect(mockInsert).not.toHaveBeenCalled();
  });
  it('error de red → network, sin fallback', async () => {
    rpcResp.publish_envelope = { data: null, error: { message: 'Failed to fetch' } };
    await expect(relay.sendEnvelope('t', 'p', 'd')).resolves.toMatchObject({ ok: false, reason: 'network' });
    expect(mockInsert).not.toHaveBeenCalled();
  });
  it('insert viejo también reconoce la cuota', async () => {
    insertErr = { code: 'PT429', message: 'relay_quota_exceeded' };
    await expect(relay.sendEnvelope('t', 'p', 'd')).resolves.toMatchObject({ ok: false, reason: 'rate_limited' });
  });
});

describe('fetchSince por RPC (D4)', () => {
  it('mapea filas, rellena topic, expone more y avanza el cursor', async () => {
    rpcResp.fetch_since = {
      data: [
        { seq: 5, payload: 'a', sender: 's', created_at: 'x', ckey: null, more: true },
        { seq: 9, payload: 'b', sender: 's', created_at: 'y', ckey: 'k', more: true },
      ],
      error: null,
    };
    const r = await relay.fetchSince('T', 3, 'yo', 200);
    expect(mockRpc).toHaveBeenCalledWith('fetch_since', { p_topic: 'T', p_since: 3, p_exclude_sender: 'yo', p_limit: 200 });
    expect(r).toMatchObject({ ok: true, cursor: 9, more: true });
    if (r.ok) {
      expect(r.envelopes[0]).toMatchObject({ seq: 5, topic: 'T' });
      expect('more' in r.envelopes[0]!).toBe(false);
    }
  });
  it('sin filas → cursor = since, more = false', async () => {
    rpcResp.fetch_since = { data: [], error: null };
    await expect(relay.fetchSince('T', 3)).resolves.toMatchObject({ ok: true, cursor: 3, more: false, envelopes: [] });
  });
  it('Gherkin «compatibilidad en F2»: sin la función cae al SELECT', async () => {
    selectRows = [{ seq: 1, topic: 'T', payload: 'a', sender: 's', created_at: 'x' }];
    await expect(relay.fetchSince('T', 0, undefined, 1)).resolves.toMatchObject({ ok: true, more: true });
    expect(mockFrom).toHaveBeenCalledWith('envelopes');
  });
  it('error de red NO cae al SELECT (no ensucia el criterio de corte)', async () => {
    rpcResp.fetch_since = { data: null, error: { message: 'Failed to fetch' } };
    await expect(relay.fetchSince('T', 0)).resolves.toMatchObject({ ok: false, reason: 'network' });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
