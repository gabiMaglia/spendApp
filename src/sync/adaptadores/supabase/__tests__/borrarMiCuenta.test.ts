/**
 * Auditoría pre-tiendas (B-1): `deleteMyAccount` llama a `delete_my_account` y
 * distingue «no hay relay» de «falló la red», igual que `deleteMyEnvelopes`.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://prueba.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-de-prueba';

let mockLlamadas: string[] = [];
let mockRespuesta: { data: unknown; error: { message: string } | null } = { data: null, error: null };

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    rpc: async (fn: string) => { mockLlamadas.push(fn); return mockRespuesta; },
  })),
}));

afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

beforeEach(() => {
  mockLlamadas = [];
  mockRespuesta = { data: null, error: null };
});

function relay() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../relay') as typeof import('../relay');
}

it('llama a delete_my_account y devuelve ok', async () => {
  expect(await relay().deleteMyAccount()).toEqual({ ok: true });
  expect(mockLlamadas).toEqual(['delete_my_account']);
});

it('un error del servidor es un fallo de red: se reintenta', async () => {
  mockRespuesta = { data: null, error: { message: 'Failed to fetch' } };
  expect(await relay().deleteMyAccount()).toEqual({ ok: false, reason: 'network', detail: 'Failed to fetch' });
});
