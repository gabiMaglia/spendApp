import { ed25519 } from '@noble/curves/ed25519.js';
import {
  resolveAuthorKeys, authorKeysFor, scheduleAuthorRefresh, pendingAuthorRefreshes,
  refreshAuthorKeys, refreshPendingAuthors,
  knownAuthorKeys, rememberAuthorKey, forgetAuthorKeys, reloadAuthorKeys,
  __resetAuthorSources,
  AUTHOR_REFRESH_MAX_POR_VUELTA,
} from '../authorKeys';
import { signCore } from '../recordSign';
import { verifiedCore, clearVerdictCache } from '../verdictCache';
import { toHex } from '../hexBytes';
import { drainGroup } from '../relaySync';
import { EXPENSE } from '@/src/test-utils/recordFixtures';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

/**
 * S4 de T-041: **resolver la clave del autor, fuera de banda**.
 *
 * Lo que se prueba acá son tres garantías, y cada una tiene su mutación en el
 * apartado final del archivo:
 *
 *  1. **Las tres fuentes se consultan como UNIÓN**, nunca como cadena que corta
 *     en la primera que contesta. La razón está en el §2 del plan:
 *     `savePeerFromCard` sólo completa huecos y nunca reemplaza
 *     (`contactChannel.ts:432-444`), así que quien reinstala la app queda con su
 *     clave VIEJA en nuestro registro local para siempre. Una cadena rechazaría
 *     todos sus registros nuevos; la unión los salva por el directorio.
 *  2. **Cero red en el camino síncrono.** `applyDelta` es síncrono (§3) y el
 *     directorio se consulta fuera de banda, al drenar, sin `await` — el mismo
 *     patrón que `observeAuthor` en `relaySync.ts:162`.
 *  3. **Una clave que todavía no tenemos da `no_verificable`** —nunca un
 *     rechazo, decisión R1 del PO— **y dispara la consulta** que sirve para la
 *     próxima vuelta.
 */

const mockGetPeer = jest.fn();
jest.mock('../contactChannel', () => ({
  getPeer: (userId: string) => mockGetPeer(userId),
}));

const mockFetchAccountKeys = jest.fn();
jest.mock('../deviceKeys', () => ({
  fetchAccountKeys: (accountId: string) => mockFetchAccountKeys(accountId),
}));

// El relay no es el sujeto de estas pruebas: sólo hace falta para que
// `drainGroup` llegue hasta el final y se vea si dispara el refresco.
jest.mock('../relay', () => ({
  isRelayConfigured: () => true,
  subscribeTopic: () => () => {},
  sendEnvelope: async () => ({ ok: true, seq: 1 }),
  fetchSince: async () => ({ ok: true, envelopes: [], cursor: 0 }),
}));

function par(seed: number) {
  const priv = new Uint8Array(32).fill(seed);
  return { priv: toHex(priv), pub: toHex(ed25519.getPublicKey(priv)) };
}

/** El teléfono que Ana perdió: su clave quedó pegada en nuestro registro local. */
const VIEJA = par(11);
/** El que se compró después. Sólo el directorio la tiene. */
const NUEVA = par(12);
const OTRA = par(13);

/** Un gasto de Ana firmado con la clave que se le pase. */
function gastoDeAna(quien: { priv: string }) {
  const nucleo = { ...EXPENSE, createdById: 'ana' };
  return { ...nucleo, ...signCore('expense', nucleo, quien.priv) };
}

const conPeer = (identityPublicKey?: string) =>
  mockGetPeer.mockImplementation(() => (identityPublicKey ? { secret: 's', identityPublicKey } : undefined));

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: 'yo' } as User });
  forgetAuthorKeys();
  clearVerdictCache();
  __resetAuthorSources();
  mockGetPeer.mockReset().mockReturnValue(undefined);
  mockFetchAccountKeys.mockReset().mockResolvedValue([]);
});

describe('las tres fuentes se consultan como UNIÓN', () => {
  it('suma lo del registro local de peers y lo de la caché de claves aceptadas', () => {
    conPeer(VIEJA.pub);
    rememberAuthorKey('ana', OTRA.pub);

    expect([...resolveAuthorKeys('ana')].sort()).toEqual([VIEJA.pub, OTRA.pub].sort());
  });

  it('una fuente que no contesta no anula a la otra: sólo peers', () => {
    conPeer(VIEJA.pub);

    expect(resolveAuthorKeys('ana')).toEqual([VIEJA.pub]);
  });

  it('una fuente que no contesta no anula a la otra: sólo caché', () => {
    rememberAuthorKey('ana', OTRA.pub);

    expect(resolveAuthorKeys('ana')).toEqual([OTRA.pub]);
  });

  it('la misma clave en dos fuentes aparece una sola vez', () => {
    conPeer(VIEJA.pub);
    rememberAuthorKey('ana', VIEJA.pub);

    expect(resolveAuthorKeys('ana')).toEqual([VIEJA.pub]);
  });

  it('un autor del que no sabemos nada da lista vacía, no explota', () => {
    expect(resolveAuthorKeys('nadie')).toEqual([]);
    expect(resolveAuthorKeys('')).toEqual([]);
  });

  /**
   * **El caso que motivó la decisión de que sea unión** (§2 del plan).
   *
   * Ana reinstaló la app. Nuestro registro local tiene su clave VIEJA y no la
   * puede pisar por diseño; el directorio por cuenta tiene la NUEVA. Una cadena
   * que preguntara primero al registro local y se conformara con su respuesta
   * marcaría como `invalida` todo lo que Ana escriba de ahora en más.
   */
  it('peer con la clave VIEJA + directorio con la NUEVA ⇒ el registro nuevo resuelve', async () => {
    conPeer(VIEJA.pub);
    mockFetchAccountKeys.mockResolvedValue([NUEVA.pub]);
    const gasto = gastoDeAna(NUEVA);

    // Primera vuelta: el registro local contesta, y contesta VIEJO.
    const antes = verifiedCore('expense', gasto, authorKeysFor('ana', gasto.k));
    expect(antes).not.toBe('valida');

    // La consulta fuera de banda, que la primera vuelta dejó encolada.
    await refreshPendingAuthors();

    // Segunda vuelta: la unión ya tiene las dos, y la firma cierra.
    expect([...resolveAuthorKeys('ana')].sort()).toEqual([VIEJA.pub, NUEVA.pub].sort());
    expect(verifiedCore('expense', gasto, authorKeysFor('ana', gasto.k))).toBe('valida');
  });

  it('la clave vieja sigue sirviendo: los registros que Ana firmó antes no se caen', async () => {
    conPeer(VIEJA.pub);
    mockFetchAccountKeys.mockResolvedValue([NUEVA.pub]);
    await refreshAuthorKeys('ana');

    const viejo = gastoDeAna(VIEJA);
    expect(verifiedCore('expense', viejo, resolveAuthorKeys('ana'))).toBe('valida');
  });
});

describe('cero red en el camino síncrono', () => {
  it('resolver no consulta el directorio', () => {
    conPeer(VIEJA.pub);
    rememberAuthorKey('ana', OTRA.pub);

    resolveAuthorKeys('ana');
    authorKeysFor('ana', NUEVA.pub);
    scheduleAuthorRefresh('ana');

    expect(mockFetchAccountKeys).not.toHaveBeenCalled();
  });

  it('resolver no toca `fetch` — ni el del directorio ni ningún otro', () => {
    const fetchSpy = jest.fn();
    const previo = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      authorKeysFor('ana', NUEVA.pub);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previo;
    }
  });

  it('devuelven un valor, no una promesa: son síncronas de verdad', () => {
    expect(Array.isArray(resolveAuthorKeys('ana'))).toBe(true);
    expect(Array.isArray(authorKeysFor('ana', NUEVA.pub))).toBe(true);
    expect(scheduleAuthorRefresh('ana')).toBeUndefined();
  });
});

describe('la clave que falta da `no_verificable` y DISPARA la consulta', () => {
  it('sin ninguna clave del autor el veredicto es `no_verificable`, nunca un rechazo', () => {
    const gasto = gastoDeAna(NUEVA);

    expect(verifiedCore('expense', gasto, authorKeysFor('ana', gasto.k)))
      .toBe('no_verificable');
  });

  it('y deja al autor encolado para la próxima vuelta', () => {
    authorKeysFor('ana', NUEVA.pub);

    expect(pendingAuthorRefreshes()).toEqual(['ana']);
  });

  /**
   * El caso de la reinstalación: tenemos claves de Ana, pero ninguna es la que
   * firmó. Si sólo se encolara al autor del que no sabemos NADA, ése —que es el
   * único caso que la unión existe para arreglar— nunca se consultaría.
   */
  it('con claves que no cubren la que firmó, también encola', () => {
    conPeer(VIEJA.pub);

    authorKeysFor('ana', NUEVA.pub);

    expect(pendingAuthorRefreshes()).toEqual(['ana']);
  });

  it('si la clave que firmó ya está resuelta, no se gasta una consulta', () => {
    conPeer(VIEJA.pub);

    authorKeysFor('ana', VIEJA.pub);

    expect(pendingAuthorRefreshes()).toEqual([]);
  });

  it('el mismo autor encolado N veces se consulta una', async () => {
    for (let i = 0; i < 5; i++) authorKeysFor('ana', NUEVA.pub);

    await refreshPendingAuthors();

    expect(mockFetchAccountKeys).toHaveBeenCalledTimes(1);
  });
});

describe('el refresco fuera de banda', () => {
  it('lo que trae el directorio queda visible para la próxima verificación', async () => {
    mockFetchAccountKeys.mockResolvedValue([NUEVA.pub]);

    await refreshAuthorKeys('ana');

    expect(knownAuthorKeys('ana')).toEqual([NUEVA.pub]);
    expect(resolveAuthorKeys('ana')).toEqual([NUEVA.pub]);
  });

  /**
   * Dos vueltas del relay que se pisan (el drenado sale sin `await`) no pueden
   * salir a preguntar dos veces lo mismo: el silencio se toma ANTES de esperar
   * la respuesta, no después.
   */
  it('dos consultas simultáneas por el mismo autor son una sola', async () => {
    await Promise.all([refreshAuthorKeys('ana'), refreshAuthorKeys('ana')]);

    expect(mockFetchAccountKeys).toHaveBeenCalledTimes(1);
  });

  it('no vuelve a preguntar por el mismo autor en la misma tanda', async () => {
    await refreshAuthorKeys('ana');
    await refreshAuthorKeys('ana');

    expect(mockFetchAccountKeys).toHaveBeenCalledTimes(1);
  });

  /**
   * El sobre lleva el estado completo del grupo y se drena cada 20 s
   * (`relayEngine.ts:61`). Sin techo, un grupo con muchos autores sin resolver
   * dispararía una ráfaga de consultas por vuelta, para siempre — el borde de
   * ADR-004 garantiza que algunos NUNCA se van a resolver.
   */
  it('tiene techo por vuelta, y lo que sobra queda pendiente', async () => {
    const autores = Array.from({ length: AUTHOR_REFRESH_MAX_POR_VUELTA + 3 }, (_, i) => `a${i}`);
    for (const a of autores) scheduleAuthorRefresh(a);

    await refreshPendingAuthors();

    expect(mockFetchAccountKeys).toHaveBeenCalledTimes(AUTHOR_REFRESH_MAX_POR_VUELTA);
    expect(pendingAuthorRefreshes()).toHaveLength(3);
  });

  it('un directorio que explota no rompe nada: se sigue sin esa clave', async () => {
    mockFetchAccountKeys.mockRejectedValue(new Error('sin red'));

    await expect(refreshPendingAuthors()).resolves.toBeUndefined();
    await expect(refreshAuthorKeys('beto')).resolves.toEqual([]);
    expect(knownAuthorKeys('beto')).toEqual([]);
  });

  it('basura del directorio no entra a la caché ni se declara aprendida', async () => {
    mockFetchAccountKeys.mockResolvedValue(['no-es-hex', '', 'ab', NUEVA.pub]);

    // Las dos afirmaciones, porque las sostienen capas distintas: la caché la
    // protege `rememberAuthorKey`, y lo que se DECLARA aprendido lo decide esta
    // función. Con sólo la primera, un refresco que miente sobre lo que
    // consiguió pasa desapercibido.
    expect(await refreshAuthorKeys('ana')).toEqual([NUEVA.pub]);
    expect(knownAuthorKeys('ana')).toEqual([NUEVA.pub]);
  });

  /**
   * La cola y el cooldown son afirmaciones sobre los pares de UNA cuenta. Si
   * sobrevivieran al cambio de cuenta, la nueva arrancaría preguntando por
   * autores ajenos y con un silencio de cinco minutos que no se ganó.
   */
  it('cambiar de cuenta vacía la cola', () => {
    scheduleAuthorRefresh('ana');

    reloadAuthorKeys();

    expect(pendingAuthorRefreshes()).toEqual([]);
  });

  it('el logout también', () => {
    scheduleAuthorRefresh('ana');

    forgetAuthorKeys();

    expect(pendingAuthorRefreshes()).toEqual([]);
  });
});

/**
 * Las fuentes se cargan perezosamente y su ausencia degrada: eso vive en
 * `authorSourcesDegrade.test.ts`, que necesita el módulo ROTO desde el require
 * hoisteado. Se intentó acá con `jest.doMock` adentro de `isolateModules` y
 * **el mock no pisaba al de arriba**: el test pasaba con la degradación rota,
 * que es exactamente el hueco que el meta-test de mutación encontró.
 */
describe('la fuente de peers no se cree cualquier cosa', () => {
  it('un `getPeer` que tira no se lleva puesta la resolución', () => {
    mockGetPeer.mockImplementation(() => { throw new Error('storage roto'); });
    rememberAuthorKey('ana', OTRA.pub);

    expect(resolveAuthorKeys('ana')).toEqual([OTRA.pub]);
  });

  it('una clave con formato inválido en el registro de peers se descarta', () => {
    conPeer('no-es-una-clave');

    expect(resolveAuthorKeys('ana')).toEqual([]);
  });
});

/**
 * Ya nos pasó tres veces en este proyecto: lógica construida, testeada y que
 * nadie llama. Arriba se prueba que el refresco anda; acá, que el sync lo USA.
 */
describe('está enchufado', () => {
  it('drainGroup dispara el refresco pendiente', async () => {
    createSecureStorage('groupkeys').clearAll();
    useGroupKeyStore.setState({ keys: [] });
    useGroupKeyStore.getState().ensureKey('G');
    scheduleAuthorRefresh('ana');

    await drainGroup('G', 'yo', 'dev-yo', 0);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockFetchAccountKeys).toHaveBeenCalledWith('ana');
  });

  // Si se esperara, cada vuelta del relay le sumaría la latencia del directorio
  // al sync. Es observación, y la observación no se mete en el camino.
  it('y lo dispara SIN await, como `observeAuthor`', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs: typeof import('fs') = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path: typeof import('path') = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../relaySync.ts'), 'utf8');

    const linea = src.split('\n').find(l => l.includes('refreshPendingAuthors('));
    expect(linea).toBeDefined();
    expect(linea).toContain('void ');
    expect(linea).not.toContain('await ');
  });
});
