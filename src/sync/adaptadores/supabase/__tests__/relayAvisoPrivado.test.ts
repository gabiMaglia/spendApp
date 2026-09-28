/**
 * T-147 (D5) · el aviso en vivo deja de depender de `postgres_changes` puro:
 * después de 011b esa policy de SELECT se borra y Realtime deja de mandar el
 * INSERT (aplica la RLS). El aviso pasa a un canal de Broadcast PRIVADO
 * (`envelopes:<topic>`, sólo `authenticated` puede escuchar y NADIE puede
 * publicar desde el cliente) — y, mientras conviven servidores viejos y
 * nuevos, también se sigue escuchando `postgres_changes` en un canal aparte
 * (`envelopes-pgc:<topic>`): cualquiera de los dos avisa.
 *
 * ⚠️ Mismo esqueleto de env + `resetModules` que `relayPrenda.test.ts`.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://prueba.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-de-prueba';

type Bind = { tipo: string; filtro: unknown; cb: (payload: unknown) => void };
type Canal = { name: string; opts?: { config?: { private?: boolean } }; binds: Bind[] };

let canales: Canal[] = [];
const removeChannel = jest.fn();
const mockCliente = {
  channel: (name: string, opts?: Canal['opts']) => {
    const canal: Canal = { name, opts, binds: [] };
    canales.push(canal);
    const chainable = {
      on: (tipo: string, filtro: unknown, cb: (payload: unknown) => void) => {
        canal.binds.push({ tipo, filtro, cb });
        return chainable;
      },
      subscribe: () => canal,
    };
    return chainable;
  },
  removeChannel,
};
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => mockCliente) }));

let relay: typeof import('../relay');

afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

beforeEach(() => {
  jest.resetModules();
  canales = [];
  removeChannel.mockClear();
  relay = require('../relay');
});

it('se suscribe al canal privado de broadcast y al de postgres_changes', () => {
  relay.subscribeTopic('T', jest.fn());
  expect(canales.map(c => [c.name, c.opts?.config?.private ?? false])).toEqual([
    ['envelopes:T', true],
    ['envelopes-pgc:T', false],
  ]);
  expect(canales[0]!.binds[0]).toMatchObject({ tipo: 'broadcast', filtro: { event: 'news' } });
  expect(canales[1]!.binds[0]).toMatchObject({ tipo: 'postgres_changes', filtro: { table: 'envelopes', filter: 'topic=eq.T' } });
});

it('cualquiera de los dos avisa, y el callback no recibe el sobre', () => {
  const onNews = jest.fn();
  relay.subscribeTopic('T', onNews);
  canales[0]!.binds[0]!.cb({ payload: { secreto: 1 } });
  canales[1]!.binds[0]!.cb({ new: { payload: 'x' } });
  expect(onNews).toHaveBeenCalledTimes(2);
  expect(onNews.mock.calls.every(c => c.length === 0)).toBe(true);
});

it('cortar quita los dos canales', () => {
  relay.subscribeTopic('T', jest.fn())();
  expect(removeChannel).toHaveBeenCalledTimes(2);
});
