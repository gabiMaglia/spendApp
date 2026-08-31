import * as fs from 'fs';
import * as path from 'path';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

const mockAnnounce = jest.fn(async (_secreto: string, _deviceId: string) => true);
const mockListPeers = jest.fn(() => ({} as Record<string, { secret: string }>));
/** Tarjeta propia. Sin sesión no hay nada que anunciar, así que siempre hay una. */
const mockCard = jest.fn(() => ({ userId: 'yo', name: 'Gabi' } as never));
/** Registro de "a quién ya le mandé qué", en memoria. */
const mockEnviadas: Record<string, string> = {};

jest.mock('../contactChannel', () => ({
  ...jest.requireActual('../contactChannel'),
  announceContact: (...a: unknown[]) => mockAnnounce(...(a as [string, string])),
  listPeers: () => mockListPeers(),
  myContactCard: () => mockCard(),
  cardFingerprint: (c: { name: string }) => `fp:${c.name}`,
  cardYaEnviada: (userId: string, huella: string) => mockEnviadas[userId] === huella,
  marcarCardEnviada: (userId: string, huella: string) => { mockEnviadas[userId] = huella; },
}));

// jest.mock se hoistea sobre los imports, así que el mock ya está puesto.
import { anunciarMiTarjeta } from '../relayEngine';

beforeEach(() => {
  mockAnnounce.mockClear();
  mockAnnounce.mockImplementation(async () => true);
  mockCard.mockReturnValue({ userId: 'yo', name: 'Gabi' } as never);
  for (const k of Object.keys(mockEnviadas)) delete mockEnviadas[k];
});

describe('anunciarMiTarjeta', () => {
  // El bug original: al renombrarse no se le avisaba a nadie, así que el
  // nombre viejo quedaba pegado en la lista de contactos del otro para siempre.
  it('le escribe a TODOS los contactos, no sólo a los incompletos', async () => {
    mockListPeers.mockReturnValue({
      ana:  { secret: 's-ana', wrapPublicKey: 'w', identityPublicKey: 'k' }, // completo
      beto: { secret: 's-beto' },                                           // incompleto
    } as never);

    await anunciarMiTarjeta();

    const destinos = mockAnnounce.mock.calls.map(c => c[0]).sort();
    expect(destinos).toEqual(['s-ana', 's-beto']);
  });

  it('sin contactos no le escribe a nadie', async () => {
    mockListPeers.mockReturnValue({} as never);
    await anunciarMiTarjeta();
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it('saltea un contacto sin secreto en vez de mandarle a un buzón vacío', async () => {
    mockListPeers.mockReturnValue({
      ana:  { secret: '' },
      beto: { secret: 's-beto' },
    } as never);

    await anunciarMiTarjeta();

    expect(mockAnnounce.mock.calls.map(c => c[0])).toEqual(['s-beto']);
  });

  // Sin red, un contacto que tira no puede dejar a los siguientes sin el
  // nombre nuevo.
  it('un contacto que falla no frena a los demás', async () => {
    mockListPeers.mockReturnValue({
      ana:  { secret: 's-ana' },
      beto: { secret: 's-beto' },
      caro: { secret: 's-caro' },
    } as never);
    mockAnnounce.mockImplementation(async (secreto: string) => {
      if (secreto === 's-beto') throw new Error('sin red');
      return true;
    });

    await expect(anunciarMiTarjeta()).resolves.toBeUndefined();
    expect(mockAnnounce.mock.calls.map(c => c[0]).sort())
      .toEqual(['s-ana', 's-beto', 's-caro']);
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

    await anunciarMiTarjeta();
    expect(mockAnnounce).toHaveBeenCalledTimes(2);

    mockAnnounce.mockClear();
    await anunciarMiTarjeta();
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it('si cambia el nombre vuelve a salir a todos', async () => {
    mockListPeers.mockReturnValue(dos as never);
    await anunciarMiTarjeta();

    mockAnnounce.mockClear();
    mockCard.mockReturnValue({ userId: 'yo', name: 'Gabriel' } as never);
    await anunciarMiTarjeta();

    expect(mockAnnounce.mock.calls.map(c => c[0]).sort()).toEqual(['s-ana', 's-beto']);
  });

  // El modo de falla que teníamos: un envío que no salía no se reintentaba nunca
  // y el otro se quedaba con el nombre viejo, sin aviso.
  it('a quien falló se le reintenta en el próximo arranque', async () => {
    mockListPeers.mockReturnValue(dos as never);
    mockAnnounce.mockImplementation(async (secreto: string) => secreto !== 's-beto');

    await anunciarMiTarjeta();

    mockAnnounce.mockClear();
    mockAnnounce.mockImplementation(async () => true);
    await anunciarMiTarjeta();

    expect(mockAnnounce.mock.calls.map(c => c[0])).toEqual(['s-beto']);
  });

  it('un envío que tira excepción tampoco se da por hecho', async () => {
    mockListPeers.mockReturnValue({ ana: { secret: 's-ana' } } as never);
    mockAnnounce.mockImplementation(async () => { throw new Error('sin red'); });
    await anunciarMiTarjeta();

    mockAnnounce.mockClear();
    mockAnnounce.mockImplementation(async () => true);
    await anunciarMiTarjeta();

    expect(mockAnnounce.mock.calls.map(c => c[0])).toEqual(['s-ana']);
  });

  it('sin sesión no hay tarjeta que mandar', async () => {
    mockListPeers.mockReturnValue(dos as never);
    mockCard.mockReturnValue(null as never);
    await anunciarMiTarjeta();
    expect(mockAnnounce).not.toHaveBeenCalled();
  });
});
