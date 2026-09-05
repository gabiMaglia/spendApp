/**
 * T-088 · La prenda en el transporte: qué viaja, qué se borra y qué pasa contra
 * un servidor sin la migración 008.
 *
 * ⚠️ **Este archivo configura credenciales de relay en `process.env`, y por eso
 * las borra en el `afterAll`.** El docblock de `relay.ts:92-97` cuenta por qué
 * importa: si quedaran puestas, otro suite del mismo worker levanta el motor de
 * relectura con su `setInterval` y Jest no termina nunca. Pasó de verdad.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://prueba.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-de-prueba';

type Fila = Record<string, unknown>;

let filasInsertadas: Fila[] = [];
let errorDeInsert: { message: string } | null = null;
let llamadasRpc: { fn: string; args: Record<string, unknown> }[] = [];
let respuestaRpc: { data: unknown; error: { message: string } | null } = { data: 0, error: null };

const mockCliente = {
  from: () => ({
    insert: (fila: Fila) => {
      filasInsertadas.push(fila);
      return {
        select: () => ({
          single: async () => (errorDeInsert
            ? { data: null, error: errorDeInsert }
            : { data: { seq: filasInsertadas.length, created_at: new Date().toISOString() }, error: null }),
        }),
      };
    },
  }),
  rpc: async (fn: string, args: Record<string, unknown>) => {
    llamadasRpc.push({ fn, args });
    return respuestaRpc;
  },
};

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => mockCliente) }));

/**
 * Los módulos se piden FRESCOS en cada caso, y no con `import` arriba: babel
 * sube los imports por encima de las dos líneas de `process.env` de acá arriba,
 * así que `relay.ts` leería las credenciales cuando todavía no están y
 * devolvería `not_configured` siempre. Pedirlos acá también deja limpio el flag
 * de módulo del degradado entre casos.
 */
let relay: typeof import('../relay');
let store: typeof import('@/src/store/identityStore');

afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

beforeEach(() => {
  filasInsertadas = [];
  llamadasRpc = [];
  errorDeInsert = null;
  respuestaRpc = { data: 0, error: null };

  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const storage = require('@/src/utils/secureStorage') as typeof import('@/src/utils/secureStorage');
  storage.createSecureStorage('groupkeys').clearAll();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  store = require('@/src/store/identityStore') as typeof import('@/src/store/identityStore');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  relay = require('../relay') as typeof import('../relay');
});

describe('la fila que se inserta', () => {
  it('sin prenda NO lleva la clave: queda igual a la de antes de T-088', () => {
    // No alcanza con que sea `undefined`. Lo que importa es que la clave no
    // viaje: es lo que hace que un servidor sin la columna la acepte.
    const fila = relay.envelopeRow('t', 'x', 'dev1');
    expect('owner_proof' in fila).toBe(false);
    expect(fila).toEqual({ topic: 't', payload: 'x', sender: 'dev1', compactable: false });
  });

  it('con prenda agrega UNA sola clave', () => {
    const proof = 'ab'.repeat(32);
    expect(relay.envelopeRow('t', 'x', 'dev1', true, proof)).toEqual({
      topic: 't', payload: 'x', sender: 'dev1', compactable: true, owner_proof: proof,
    });
  });

  it('un proof vacío o nulo no agrega la clave', () => {
    expect('owner_proof' in relay.envelopeRow('t', 'x', 'd', true, null)).toBe(false);
    expect('owner_proof' in relay.envelopeRow('t', 'x', 'd', true, '')).toBe(false);
  });

  it('NUNCA lleva la huella: la tag la deriva el servidor', () => {
    // Si el cliente pudiera elegir la tag copiaría la ajena. El servidor la
    // pisa igual (008), pero mandarla declararía una intención equivocada.
    expect('owner_tag' in relay.envelopeRow('t', 'x', 'd', true, 'ab'.repeat(32))).toBe(false);
  });
});

describe('publicar estampa la prenda', () => {
  it('lo que viaja es el proof, nunca el secreto', () => {
    const { secret, proof } = store.ensureOwnerPledge();
    return relay.sendEnvelope('t', 'payload', 'dev1', true).then(r => {
      expect(r.ok).toBe(true);
      expect(filasInsertadas[0]!.owner_proof).toBe(proof);
      expect(JSON.stringify(filasInsertadas[0])).not.toContain(secret);
    });
  });
});

/**
 * El degradado de T-088 §4. Si alguien despliega la app antes que la migración
 * —o corre el rollback— el INSERT con la columna se rechaza y **el grupo deja
 * de sincronizar**. Es la falla más cara de este ticket.
 */
describe('servidor sin la migración', () => {
  it('reintenta UNA vez sin la columna y el envío sale', async () => {
    store.ensureOwnerPledge();
    errorDeInsert = { message: "Could not find the 'owner_proof' column of 'envelopes'" };

    const r = await relay.sendEnvelope('t', 'x', 'dev1', true);
    // El primer intento falló; el segundo va sin prenda. Como el cliente falso
    // devuelve el mismo error siempre, lo que se verifica es la FORMA de los
    // dos intentos, no que el segundo funcione contra un servidor real.
    expect(filasInsertadas).toHaveLength(2);
    expect('owner_proof' in filasInsertadas[0]!).toBe(true);
    expect('owner_proof' in filasInsertadas[1]!).toBe(false);
    expect(r.ok).toBe(false);   // el falso sigue rechazando
  });

  it('después del rechazo, los envíos siguientes ya salen sin prenda', async () => {
    store.ensureOwnerPledge();
    errorDeInsert = { message: "column envelopes.owner_proof does not exist" };
    await relay.sendEnvelope('t', 'x', 'dev1', true);

    filasInsertadas = [];
    errorDeInsert = null;
    const r = await relay.sendEnvelope('t', 'y', 'dev1', true);

    expect(r.ok).toBe(true);
    expect(filasInsertadas).toHaveLength(1);          // un solo intento
    expect('owner_proof' in filasInsertadas[0]!).toBe(false);
  });

  it('un error de red común NO activa el degradado', async () => {
    store.ensureOwnerPledge();
    errorDeInsert = { message: 'fetch failed' };
    await relay.sendEnvelope('t', 'x', 'dev1', true);

    filasInsertadas = [];
    errorDeInsert = null;
    await relay.sendEnvelope('t', 'y', 'dev1', true);

    expect(filasInsertadas).toHaveLength(1);
    expect('owner_proof' in filasInsertadas[0]!).toBe(true);   // sigue estampando
  });
});

describe('borrar lo propio', () => {
  it('presenta el PREIMAGEN, nunca la huella', async () => {
    const { secret, proof } = store.ensureOwnerPledge();
    respuestaRpc = { data: 3, error: null };

    const r = await relay.deleteMyEnvelopes('t');

    expect(r).toEqual({ ok: true, deleted: 3 });
    expect(llamadasRpc).toHaveLength(1);
    expect(llamadasRpc[0]!.fn).toBe('delete_my_envelopes');
    expect(llamadasRpc[0]!.args).toEqual({ p_topic: 't', p_secret: secret });
    expect(JSON.stringify(llamadasRpc[0]!.args)).not.toContain(proof);
  });

  it('sin prenda devuelve `no_pledge` SIN tocar la red', async () => {
    // Reinstalación, o sobres anteriores a T-088. Que no llame es el punto: el
    // secreto no se inventa, y quien muestre esto no puede prometer más que el
    // TTL de 30 días.
    jest.resetModules();
    jest.doMock('../ownerPledge', () => ({ prendaDelAparato: () => null }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const relaySinPrenda = require('../relay') as typeof import('../relay');

    const r = await relaySinPrenda.deleteMyEnvelopes('t');

    expect(r).toEqual({ ok: false, reason: 'no_pledge' });
    expect(llamadasRpc).toHaveLength(0);

    jest.dontMock('../ownerPledge');
    jest.resetModules();
  });

  it('un error del servidor se devuelve, no se disfraza de éxito', async () => {
    store.ensureOwnerPledge();
    respuestaRpc = { data: null, error: { message: 'function does not exist' } };

    const r = await relay.deleteMyEnvelopes('t');

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('network');
      expect(r.detail).toContain('does not exist');
    }
  });
});
