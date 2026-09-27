/**
 * T-147 (SIMPLIFICACIÓN 2026-09-27) · el directorio de claves (ADR-004) usa
 * un cliente de Supabase PROPIO, separado del buzón: el buzón corre con una
 * sesión anónima por instalación (`relay.ts`/`relaySession.ts`); el
 * directorio necesita la sesión de CUENTA (Google/Apple, `signInWithIdToken`)
 * sólo para poder probarle al servidor de qué cuenta es la clave que se
 * registra (`registerDeviceKey`). Nunca deben compartir storage: si
 * compartieran, un JWT de cuenta terminaría viajando con los pedidos del
 * buzón (justo lo que el PO pidió evitar).
 */
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://prueba.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-de-prueba';

let opciones: { auth?: Record<string, unknown> } = {};
const mockCliente = { auth: {} };
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn((_u: string, _k: string, o: typeof opciones) => { opciones = o; return mockCliente; }),
}));

let D: typeof import('../directoryClient');
let relaySession: typeof import('../relaySession');

afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

beforeEach(() => {
  jest.resetModules();
  opciones = {};
  D = require('../directoryClient');
  relaySession = require('../relaySession');
});

describe('getDirectoryClient', () => {
  it('null si el relay no está configurado', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    jest.resetModules();
    D = require('../directoryClient');
    expect(D.getDirectoryClient()).toBeNull();
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://prueba.local';
  });

  it('no persiste sesión (Fase A: login puntual, sólo para registerDeviceKey)', () => {
    D.getDirectoryClient();
    expect(opciones.auth).toMatchObject({ persistSession: false, detectSessionInUrl: false });
  });

  it('usa un storage DISTINTO del que usa la sesión del buzón', () => {
    D.getDirectoryClient();
    const storageDelDirectorio = opciones.auth!.storage as { setItem(k: string, v: string): void; getItem(k: string): string | null };
    storageDelDirectorio.setItem('k', 'del-directorio');

    const storageDelBuzon = relaySession.supabaseAuthStorage();
    // Si compartieran bucket, esta lectura vería el valor de arriba.
    expect(storageDelBuzon.getItem('k')).toBeNull();
  });

  it('singleton: llamarla dos veces no crea un cliente nuevo', () => {
    const a = D.getDirectoryClient();
    const b = D.getDirectoryClient();
    expect(a).toBe(b);
    const { createClient } = require('@supabase/supabase-js');
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});
