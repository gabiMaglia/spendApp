import {
  checkAuthor, observeAuthor, unverifiedAuthors, clearAuthorObservations,
} from '../authorHealth';

const mockFetch = jest.fn(async (_accountId: string) => [] as string[]);
jest.mock('../deviceKeys', () => ({
  fetchAccountKeys: (accountId: string) => mockFetch(accountId),
}));

beforeEach(() => {
  clearAuthorObservations();
  mockFetch.mockReset();
  mockFetch.mockImplementation(async () => []);
});

describe('verificar autoría contra el directorio', () => {
  it('la clave registrada bajo esa cuenta da ok', async () => {
    mockFetch.mockImplementation(async () => ['aa', 'bb']);
    expect(await checkAuthor('cuenta-ana', 'bb')).toBe('ok');
  });

  it('una clave que no figura queda marcada', async () => {
    mockFetch.mockImplementation(async () => ['aa']);
    expect(await checkAuthor('cuenta-ana', 'zz')).toBe('clave_desconocida');
  });

  /**
   * Vacío es falta de información, NO una sospecha. Sin esta distinción un
   * corte de red marcaría a todo el mundo como no verificado, que es justo el
   * dato que estamos tratando de medir.
   */
  it('sin poder preguntar NO se acusa a nadie', async () => {
    mockFetch.mockImplementation(async () => []);
    expect(await checkAuthor('cuenta-ana', 'zz')).toBe('sin_directorio');
  });

  it('sin cuenta o sin clave tampoco se acusa', async () => {
    mockFetch.mockImplementation(async () => ['aa']);
    expect(await checkAuthor('', 'aa')).toBe('sin_directorio');
    expect(await checkAuthor('cuenta-ana', '')).toBe('sin_directorio');
  });
});

describe('caché de claves', () => {
  it('no vuelve a preguntar por la misma cuenta', async () => {
    mockFetch.mockImplementation(async () => ['aa']);
    await checkAuthor('cuenta-ana', 'aa');
    await checkAuthor('cuenta-ana', 'aa');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // Un vacío cacheado dejaría pegado un corte de red por todo el TTL.
  it('un vacío no se cachea', async () => {
    mockFetch.mockImplementation(async () => []);
    await checkAuthor('cuenta-ana', 'aa');
    await checkAuthor('cuenta-ana', 'aa');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  /**
   * El falso positivo que más importa: la otra persona agregó un teléfono
   * DESPUÉS de que cacheamos. Acusarla por tener el dato viejo sería peor que
   * no verificar.
   */
  it('antes de acusar vuelve a preguntar sin caché', async () => {
    mockFetch.mockImplementation(async () => ['aa']);
    await checkAuthor('cuenta-ana', 'aa');           // deja el caché puesto

    mockFetch.mockImplementation(async () => ['aa', 'nueva']);
    expect(await checkAuthor('cuenta-ana', 'nueva')).toBe('ok');
  });
});

describe('observación (modo aviso)', () => {
  it('anota sólo lo que no verifica', async () => {
    mockFetch.mockImplementation(async () => ['aa']);

    await observeAuthor('g1', 'cuenta-ana', 'aa');
    expect(unverifiedAuthors()).toEqual([]);

    await observeAuthor('g1', 'cuenta-ana', 'zz');
    expect(unverifiedAuthors()).toHaveLength(1);
    expect(unverifiedAuthors()[0]).toMatchObject({
      groupId: 'g1', accountId: 'cuenta-ana', senderKey: 'zz', count: 1,
    });
  });

  // Un contador dice más que N filas iguales llenando la pantalla.
  it('lo mismo repetido suma al contador, no agrega filas', async () => {
    mockFetch.mockImplementation(async () => ['aa']);
    await observeAuthor('g1', 'cuenta-ana', 'zz');
    await observeAuthor('g1', 'cuenta-ana', 'zz');
    await observeAuthor('g1', 'cuenta-ana', 'zz');

    expect(unverifiedAuthors()).toHaveLength(1);
    expect(unverifiedAuthors()[0].count).toBe(3);
  });

  it('separa por grupo y por clave', async () => {
    mockFetch.mockImplementation(async () => ['aa']);
    await observeAuthor('g1', 'cuenta-ana', 'zz');
    await observeAuthor('g2', 'cuenta-ana', 'zz');
    await observeAuthor('g1', 'cuenta-ana', 'yy');
    expect(unverifiedAuthors()).toHaveLength(3);
  });

  // Observar NO puede romper el sync: es la premisa de todo el modo aviso.
  it('si el directorio explota, devuelve sin_directorio y no tira', async () => {
    mockFetch.mockImplementation(async () => { throw new Error('boom'); });
    await expect(observeAuthor('g1', 'cuenta-ana', 'zz')).resolves.toBe('sin_directorio');
    expect(unverifiedAuthors()).toEqual([]);
  });

  it('sin directorio no acusa', async () => {
    mockFetch.mockImplementation(async () => []);
    await observeAuthor('g1', 'cuenta-ana', 'zz');
    expect(unverifiedAuthors()).toEqual([]);
  });
});

/**
 * Ya nos pasó tres veces en este proyecto: lógica construida, testeada y que
 * nadie llama. Arriba se prueba que la observación anda; acá, que el sync la
 * USA y que la pantalla la MUESTRA. Sin las dos cosas el número no existe.
 */
describe('está enchufado', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs: typeof import('fs') = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path: typeof import('path') = require('path');
  const leer = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

  it('drainGroup observa cada sobre que aplica', () => {
    const src = leer('../relaySync.ts');
    expect(src).toContain('observeAuthor(');
  });

  // Si se descartara, un borde no medido dejaría gente legítima sin sincronizar.
  it('drainGroup NO descarta por el veredicto', () => {
    const src = leer('../relaySync.ts');
    const linea = src.split('\n').find(l => l.includes('observeAuthor('))!;
    expect(linea).toContain('void ');
  });

  it('la pantalla de diagnóstico lo muestra', () => {
    expect(leer('../../../app/debug/identity.tsx')).toContain('unverifiedAuthors()');
  });
});
