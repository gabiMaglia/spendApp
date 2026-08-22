import { registerDeviceKey, fetchAccountKeys } from '../deviceKeys';
import { signIntoDirectory } from '../directoryAuth';
import { useAuthStore } from '@/src/store/authStore';
import { ensureIdentity } from '@/src/store/identityStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

/**
 * El directorio de claves (ADR-004). Lo que importa verificar acá NO es la
 * seguridad —esa la sostiene la RLS del servidor— sino que **nada de esto pueda
 * romper la app**: sin configurar, sin sesión o sin red, todo sigue andando.
 */

const estado = {
  cliente: true as boolean,
  sesion: true as boolean,
  errorUpsert: null as { code?: string; message: string } | null,
  filas: [] as { public_key: string }[],
  errorSelect: false,
  upserts: [] as unknown[],
  signIn: null as { message: string } | null,
  /** null = la funcion existe. Un objeto = el error que devuelve Supabase. */
  errorRpc: null as { message: string } | null,
  /** true = ni siquiera existe el metodo (cliente viejo). */
  rpcExplota: false,
  filasRpc: [] as { public_key: string }[],
  rpcArgs: [] as unknown[],
};

jest.mock('../relay', () => ({
  getRelayClient: () => estado.cliente ? {
    auth: {
      getSession: async () => ({ data: { session: estado.sesion ? { user: {} } : null } }),
      signInWithIdToken: async () => ({ error: estado.signIn }),
      signOut: async () => ({}),
    },
    rpc: async (nombre: string, args: unknown) => {
      if (estado.rpcExplota) throw new TypeError('rpc no existe');
      estado.rpcArgs.push([nombre, args]);
      return estado.errorRpc
        ? { data: null, error: estado.errorRpc }
        : { data: estado.filasRpc, error: null };
    },
    from: () => ({
      upsert: async (fila: unknown) => { estado.upserts.push(fila); return { error: estado.errorUpsert }; },
      select: () => ({
        eq: async () => estado.errorSelect
          ? { data: null, error: { message: 'boom' } }
          : { data: estado.filas, error: null },
      }),
    }),
  } : null,
  isRelayConfigured: () => estado.cliente,
}));

beforeEach(() => {
  createSecureStorage('groupkeys').clearAll();
  useAuthStore.setState({ currentUser: { id: 'cuenta-ana' } as User });
  Object.assign(estado, {
    cliente: true, sesion: true, errorUpsert: null,
    filas: [], errorSelect: false, upserts: [], signIn: null,
    errorRpc: null, rpcExplota: false, filasRpc: [], rpcArgs: [],
  });
});

describe('registrar la clave de este dispositivo', () => {
  it('publica la pública de este aparato bajo la cuenta activa', async () => {
    const esperada = ensureIdentity().publicKey;

    expect(await registerDeviceKey()).toEqual({ ok: true, alreadyThere: false });
    expect(estado.upserts[0]).toEqual({ account_id: 'cuenta-ana', public_key: esperada });
  });

  // La privada NO se mueve: es la propiedad que hace que esto no necesite ni
  // contraseña ni sincronizar secretos.
  it('NUNCA manda la clave privada', async () => {
    const privada = ensureIdentity().privateKey;
    await registerDeviceKey();

    expect(JSON.stringify(estado.upserts)).not.toContain(privada);
  });

  it('llamarla dos veces no molesta (es idempotente del lado del server)', async () => {
    await registerDeviceKey();
    expect((await registerDeviceKey()).ok).toBe(true);
  });
});

describe('nada de esto puede romper la app', () => {
  it('sin relay configurado', async () => {
    estado.cliente = false;
    expect(await registerDeviceKey()).toMatchObject({ ok: false, reason: 'not_configured' });
  });

  it('sin sesión en el directorio', async () => {
    estado.sesion = false;
    expect(await registerDeviceKey()).toMatchObject({ ok: false, reason: 'no_session' });
  });

  it('sin cuenta activa', async () => {
    useAuthStore.setState({ currentUser: null });
    expect(await registerDeviceKey()).toMatchObject({ ok: false, reason: 'no_account' });
  });

  // Un rechazo de la RLS se arregla en otro lado que un problema de red: hay
  // que poder distinguirlos en el diagnóstico.
  it('un rechazo de la RLS se distingue de un problema de red', async () => {
    estado.errorUpsert = { code: '42501', message: 'new row violates row-level security policy' };
    expect(await registerDeviceKey()).toMatchObject({ ok: false, reason: 'denied' });

    estado.errorUpsert = { message: 'fetch failed' };
    expect(await registerDeviceKey()).toMatchObject({ ok: false, reason: 'network' });
  });
});

describe('leer las claves de una cuenta', () => {
  // El camino normal pasa por la función `account_keys` (ver 005). La consulta
  // directa a la tabla quedó como respaldo y se prueba más abajo.
  it('devuelve las registradas', async () => {
    estado.filasRpc = [{ public_key: 'aa' }, { public_key: 'bb' }];
    expect(await fetchAccountKeys('cuenta-ana')).toEqual(['aa', 'bb']);
  });

  /**
   * Vacío significa "no pude preguntar" tanto como "no tiene ninguna". La Fase B
   * tiene que tratarlo como "no verificar" y NUNCA como "rechazar": si no, un
   * corte de red dejaría a todo el mundo sin poder sincronizar.
   */
  it('un error de consulta devuelve vacío, no una excepción', async () => {
    estado.errorSelect = true;
    expect(await fetchAccountKeys('cuenta-ana')).toEqual([]);
  });

  it('sin relay configurado devuelve vacío', async () => {
    estado.cliente = false;
    expect(await fetchAccountKeys('cuenta-ana')).toEqual([]);
  });
});

describe('resolver claves por PERSONA, no por proveedor (005)', () => {
  // El caso que motiva la migración: Google en un teléfono, Apple en el otro.
  // Sin esto, la fase B rechazaría el segundo dispositivo de alguien legítimo.
  it('usa la función y le pasa la cuenta', async () => {
    estado.filasRpc = [{ public_key: 'aa' }, { public_key: 'bb' }];
    expect(await fetchAccountKeys('cuenta-ana')).toEqual(['aa', 'bb']);
    expect(estado.rpcArgs[0]).toEqual(['account_keys', { p_account_id: 'cuenta-ana' }]);
  });

  // La 005 se corre a mano: un cliente actualizado puede llegar antes que ella.
  // Quedarse sin claves ahí se leería como "este sobre no verifica".
  it('si la función todavía no existe cae a la consulta vieja', async () => {
    estado.errorRpc = { message: 'function public.account_keys does not exist' };
    estado.filas = [{ public_key: 'cc' }];
    expect(await fetchAccountKeys('cuenta-ana')).toEqual(['cc']);
  });

  it('un cliente sin rpc tampoco rompe', async () => {
    estado.rpcExplota = true;
    estado.filas = [{ public_key: 'dd' }];
    expect(await fetchAccountKeys('cuenta-ana')).toEqual(['dd']);
  });

  // Vacío tiene que seguir significando "no pude preguntar", nunca "rechazar".
  it('si fallan los dos caminos devuelve vacío', async () => {
    estado.rpcExplota = true;
    estado.errorSelect = true;
    expect(await fetchAccountKeys('cuenta-ana')).toEqual([]);
  });
});

describe('sesión del directorio', () => {
  it('sin id_token no se intenta: es el fallo más probable y hay que nombrarlo', async () => {
    expect(await signIntoDirectory('google', null)).toMatchObject({ ok: false, reason: 'no_token' });
  });

  it('con token entra', async () => {
    expect(await signIntoDirectory('google', 'tok')).toEqual({ ok: true });
  });

  it('un rechazo del servidor no tira', async () => {
    estado.signIn = { message: 'nonce mismatch' };
    expect(await signIntoDirectory('apple', 'tok')).toMatchObject({ ok: false, reason: 'rejected' });
  });
});
