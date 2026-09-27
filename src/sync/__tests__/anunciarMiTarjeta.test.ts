import * as fs from 'fs';
import * as path from 'path';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

/**
 * T-147 (R4-2, ronda 4; SIMPLIFICACIÓN 2026-09-27): `anunciarMiTarjeta`
 * encola por `relayQueue` en vez de mandar todo en un loop directo (ver el
 * docblock de `relayEngine.ts` — el PoC del verificador combinaba 13
 * tarjetas + 11 claves en el mismo minuto de cuota, y las tarjetas sin ritmo
 * empujaban a las claves a agotarse). Por eso el mock es
 * `announceCardResultado` (expone el motivo, como `sendGroupKeyResultado`) y
 * cada `await anunciarMiTarjeta()` de este archivo va seguido de un drenaje
 * de la cola con timers falsos.
 *
 * `announceCardResultado` recibe la tarjeta YA ARMADA (punto 4 de la
 * simplificación: se arma al ENCOLAR, no al ejecutar, para que un cambio de
 * cuenta en el medio no la reemplace) — el mock ignora ese primer argumento y
 * conserva la firma vieja de `mockAnnounce(secreto, deviceId)` para no tener
 * que tocar las aserciones de todo el archivo.
 */
type ResultadoAnuncio = { ok: true; seq: number } | { ok: false; reason: string };
const mockAnnounce = jest.fn(async (_secreto: string, _deviceId: string): Promise<ResultadoAnuncio> => ({ ok: true, seq: 1 }));
const mockListPeers = jest.fn(() => ({} as Record<string, { secret: string }>));
/** Tarjeta propia. Sin sesión no hay nada que anunciar, así que siempre hay una. */
const mockCard = jest.fn(() => ({ userId: 'yo', name: 'Gabi' } as never));
/** Registro de "a quién ya le mandé qué", en memoria. */
const mockEnviadas: Record<string, string> = {};

jest.mock('../contactChannel', () => ({
  ...jest.requireActual('../contactChannel'),
  announceCardResultado: (_card: unknown, secreto: string, deviceId: string) => mockAnnounce(secreto, deviceId),
  listPeers: () => mockListPeers(),
  myContactCard: () => mockCard(),
  cardFingerprint: (c: { name: string }) => `fp:${c.name}`,
  cardYaEnviada: (userId: string, huella: string) => mockEnviadas[userId] === huella,
  marcarCardEnviada: (userId: string, huella: string) => { mockEnviadas[userId] = huella; },
}));

// jest.mock se hoistea sobre los imports, así que el mock ya está puesto.
import { anunciarMiTarjeta } from '../relayEngine';
import { __resetRelayQueue, __colaLength, QUEUE_INTERVAL_MS } from '../relayQueue';

/** Corre `anunciarMiTarjeta` y deja que la cola drene TODO lo que encoló en
 *  esa llamada (nunca más de `tope` vueltas, por si algo queda reintentando
 *  para siempre — sería un bug del test, no algo que colgar el runner). */
async function anunciarYDrenar(tope = 20): Promise<void> {
  await anunciarMiTarjeta();
  for (let i = 0; i < tope && __colaLength() > 0; i++) {
    await jest.advanceTimersByTimeAsync(QUEUE_INTERVAL_MS);
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  __resetRelayQueue();
  mockAnnounce.mockClear();
  mockAnnounce.mockImplementation(async () => ({ ok: true, seq: 1 }));
  mockCard.mockReturnValue({ userId: 'yo', name: 'Gabi' } as never);
  for (const k of Object.keys(mockEnviadas)) delete mockEnviadas[k];
});
afterEach(() => {
  __resetRelayQueue();
  jest.useRealTimers();
});

describe('anunciarMiTarjeta', () => {
  // El bug original: al renombrarse no se le avisaba a nadie, así que el
  // nombre viejo quedaba pegado en la lista de contactos del otro para siempre.
  it('le escribe a TODOS los contactos, no sólo a los incompletos', async () => {
    mockListPeers.mockReturnValue({
      ana:  { secret: 's-ana', wrapPublicKey: 'w', identityPublicKey: 'k' }, // completo
      beto: { secret: 's-beto' },                                           // incompleto
    } as never);

    await anunciarYDrenar();

    const destinos = mockAnnounce.mock.calls.map(c => c[0]).sort();
    expect(destinos).toEqual(['s-ana', 's-beto']);
  });

  it('sin contactos no le escribe a nadie', async () => {
    mockListPeers.mockReturnValue({} as never);
    await anunciarYDrenar();
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it('saltea un contacto sin secreto en vez de mandarle a un buzón vacío', async () => {
    mockListPeers.mockReturnValue({
      ana:  { secret: '' },
      beto: { secret: 's-beto' },
    } as never);

    await anunciarYDrenar();

    expect(mockAnnounce.mock.calls.map(c => c[0])).toEqual(['s-beto']);
  });

  // Sin red, un contacto que falla no puede dejar a los siguientes sin el
  // nombre nuevo — con la cola (R4-2), un fallo TRANSITORIO se reintenta
  // solo (con backoff) en vez de perderse hasta el próximo arranque; los
  // demás contactos, mientras tanto, no esperan a que ése se resuelva
  // (`relayQueue` no bloquea en cabeza, R3-3(a)).
  it('un contacto que falla no frena a los demás, y se reintenta solo', async () => {
    mockListPeers.mockReturnValue({
      ana:  { secret: 's-ana' },
      beto: { secret: 's-beto' },
      caro: { secret: 's-caro' },
    } as never);
    let primerIntentoBeto = true;
    mockAnnounce.mockImplementation(async (secreto: string) => {
      if (secreto === 's-beto' && primerIntentoBeto) { primerIntentoBeto = false; throw new Error('sin red'); }
      return { ok: true, seq: 1 };
    });

    await anunciarYDrenar();

    // ana y caro no esperaron a que beto se resolviera; beto salió en el
    // reintento.
    expect(new Set(mockAnnounce.mock.calls.map(c => c[0]))).toEqual(new Set(['s-ana', 's-beto', 's-caro']));
  });
});

/**
 * Guarda contra el modo de falla que ya nos pasó tres veces en este proyecto:
 * lógica construida, testeada y que nadie llama. Los tests de arriba prueban
 * que `anunciarMiTarjeta` anda; este prueba que renombrarse la USA.
 */
describe('nadie edita su propio perfil por la izquierda', () => {
  /**
   * Antes esto miraba el interior de `handleSaveName` buscando las llamadas.
   * Servía para el renombre y no vio los otros dos casos del MISMO bug:
   * cambiar la foto, y adoptar la de Google al entrar. Los dos guardaban en
   * `authStore` y nada más, así que el dato no llegaba a `userStore` —que es lo
   * que arma el delta de sync— ni se anunciaba a los contactos: lo veía su
   * dueño y nadie más.
   *
   * Ahora hay un solo lugar que edita el perfil propio (`actualizarMiPerfil`) y
   * el guard vigila la CLASE: ninguna pantalla escribe el usuario por su cuenta.
   * La excepción es el login, que CREA la sesión en vez de editarla — y ahí la
   * re-hidratación por cambio de cuenta ya alinea `userStore`.
   */
  const APP = path.join(__dirname, '../../../app');
  const PERMITIDOS = new Set(['auth/index.tsx']);

  function tsx(dir: string): string[] {
    return fs.readdirSync(dir).flatMap(n => {
      const ruta = path.join(dir, n);
      if (fs.statSync(ruta).isDirectory()) return tsx(ruta);
      return /\.tsx$/.test(n) ? [ruta] : [];
    });
  }

  it('ninguna pantalla llama `setUser` fuera del login', () => {
    const culpables: string[] = [];
    for (const ruta of tsx(APP)) {
      const rel = path.relative(APP, ruta);
      if (PERMITIDOS.has(rel)) continue;
      fs.readFileSync(ruta, 'utf8').split('\n').forEach((linea, i) => {
        if (/\bsetUser\s*\(/.test(linea)) culpables.push(`${rel}:${i + 1}`);
      });
    }
    expect(culpables).toEqual([]);
  });

  it('el login usa `actualizarMiPerfil` para la foto del proveedor', () => {
    // Es la única escritura del login que NO es la creación de la sesión: pasa
    // después, cuando la re-hidratación ya corrió y no la va a alinear.
    const src = fs.readFileSync(path.join(APP, 'auth/index.tsx'), 'utf8');
    expect(src).toContain('actualizarMiPerfil({ avatar: foto })');
  });
});

describe('anunciarMiTarjeta — no repite al pedo', () => {
  const dos = { ana: { secret: 's-ana' }, beto: { secret: 's-beto' } };

  // Corre en cada arranque. Sin esto serían N sobres por apertura, para siempre.
  it('la segunda vuelta sin cambios no manda nada', async () => {
    mockListPeers.mockReturnValue(dos as never);

    await anunciarYDrenar();
    expect(mockAnnounce).toHaveBeenCalledTimes(2);

    mockAnnounce.mockClear();
    await anunciarYDrenar();
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it('si cambia el nombre vuelve a salir a todos', async () => {
    mockListPeers.mockReturnValue(dos as never);
    await anunciarYDrenar();

    mockAnnounce.mockClear();
    mockCard.mockReturnValue({ userId: 'yo', name: 'Gabriel' } as never);
    await anunciarYDrenar();

    expect(mockAnnounce.mock.calls.map(c => c[0]).sort()).toEqual(['s-ana', 's-beto']);
  });

  // El modo de falla que teníamos: un envío que no salía no se reintentaba nunca
  // y el otro se quedaba con el nombre viejo, sin aviso. Con la cola (R4-2),
  // ni siquiera hace falta esperar al próximo arranque: se reintenta solo.
  it('a quien falló se le reintenta solo, sin esperar al próximo arranque', async () => {
    mockListPeers.mockReturnValue(dos as never);
    mockAnnounce.mockImplementation(async (secreto: string) =>
      secreto === 's-beto' ? { ok: false, reason: 'network' as const } : { ok: true, seq: 1 });

    await anunciarYDrenar();

    expect(mockAnnounce.mock.calls.filter(c => c[0] === 's-beto').length).toBeGreaterThan(1);
    expect(mockEnviadas.beto).toBeUndefined(); // nunca se marcó (no salió)
    expect(mockEnviadas.ana).toBe('fp:Gabi');
  });

  it('un envío que tira excepción tampoco se da por hecho', async () => {
    mockListPeers.mockReturnValue({ ana: { secret: 's-ana' } } as never);
    mockAnnounce.mockImplementation(async () => { throw new Error('sin red'); });

    // No se agota: la cola sigue reintentando (R3-3(a) fija un tope de 8, no
    // infinito) — alcanza con ver que nunca se marcó como enviada.
    await anunciarMiTarjeta();
    for (let i = 0; i < 10; i++) await jest.advanceTimersByTimeAsync(QUEUE_INTERVAL_MS);

    expect(mockEnviadas.ana).toBeUndefined();
  });

  it('sin sesión no hay tarjeta que mandar', async () => {
    mockListPeers.mockReturnValue(dos as never);
    mockCard.mockReturnValue(null as never);
    await anunciarYDrenar();
    expect(mockAnnounce).not.toHaveBeenCalled();
  });
});

/**
 * T-147 (punto 4 de la simplificación): un cambio de cuenta entre el
 * `encolar` y el `ejecutar` no puede hacer que la tarjeta de la cuenta
 * ANTERIOR salga con la sesión de la cuenta NUEVA.
 */
describe('anunciarMiTarjeta — el dueño se fija al encolar', () => {
  it('si la cuenta activa cambió antes de que el trabajo corra, se descarta sin mandar nada', async () => {
    const { useAuthStore } = require('@/src/store/authStore') as typeof import('@/src/store/authStore');
    useAuthStore.setState({ currentUser: { id: 'cuenta-A' } as never });
    mockListPeers.mockReturnValue({ ana: { secret: 's-ana' } } as never);

    await anunciarMiTarjeta(); // encola con owner = 'cuenta-A'
    useAuthStore.setState({ currentUser: { id: 'cuenta-B' } as never }); // cambia ANTES de que corra

    for (let i = 0; i < 5 && __colaLength() > 0; i++) {
      await jest.advanceTimersByTimeAsync(QUEUE_INTERVAL_MS);
    }

    expect(mockAnnounce).not.toHaveBeenCalled();
    useAuthStore.setState({ currentUser: null });
  });
});
