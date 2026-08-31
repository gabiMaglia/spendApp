import { ed25519 } from '@noble/curves/ed25519.js';
import {
  authorKeysFor, authorKeyWasAsked, refreshAuthorKeys, refreshPendingAuthors,
  forgetAuthorKeys, reloadAuthorKeys, __resetAuthorSources,
} from '../authorKeys';
import { toHex } from '../hexBytes';
import { useAuthStore } from '@/src/store/authStore';
import type { User } from '@/src/types/models';

/**
 * **D2 · una clave stale no puede producir `invalida`** — la mitad que vive en
 * `authorKeys`.
 *
 * `savePeerFromCard` sólo completa huecos y nunca reemplaza, así que quien
 * reinstala la app queda en nuestro registro local con su clave VIEJA. En ese
 * momento `authorKeys` no está vacío —tiene una clave, la equivocada— y el
 * veredicto sería `invalida` para un autor honesto.
 *
 * Lo que hace falta para no acusarlo es un dato que antes no existía: **¿ya le
 * preguntamos al directorio por ESTA clave presentada, y contestó?** No alcanza
 * con "¿le preguntamos alguna vez por este autor?": una respuesta de hace diez
 * minutos es anterior a la reinstalación y no dice nada sobre la clave nueva.
 */

const mockGetPeer = jest.fn();
jest.mock('../contactChannel', () => ({
  getPeer: (userId: string) => mockGetPeer(userId),
}));

const mockFetchAccountKeys = jest.fn();
jest.mock('../deviceKeys', () => ({
  fetchAccountKeys: (accountId: string) => mockFetchAccountKeys(accountId),
}));

function par(seed: number) {
  const priv = new Uint8Array(32).fill(seed);
  return { priv: toHex(priv), pub: toHex(ed25519.getPublicKey(priv)) };
}

const VIEJA = par(21);
const NUEVA = par(22);

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: 'yo' } as User });
  forgetAuthorKeys();
  reloadAuthorKeys();
  __resetAuthorSources();
  mockGetPeer.mockReset();
  mockFetchAccountKeys.mockReset();
  // El registro local tiene la clave que Ana tenía antes de reinstalar.
  mockGetPeer.mockImplementation(() => ({ secret: 's', identityPublicKey: VIEJA.pub }));
  mockFetchAccountKeys.mockResolvedValue([]);
});

describe('“¿ya preguntamos por esta clave?”', () => {
  it('antes de preguntar nada, no preguntamos por ninguna', () => {
    expect(authorKeyWasAsked('ana', NUEVA.pub)).toBe(false);
  });

  it('encolar la consulta no es haberla hecho', () => {
    authorKeysFor('ana', NUEVA.pub);
    expect(authorKeyWasAsked('ana', NUEVA.pub)).toBe(false);
  });

  it('recién cuando el directorio contesta queda preguntada', async () => {
    authorKeysFor('ana', NUEVA.pub);
    await refreshPendingAuthors();
    expect(authorKeyWasAsked('ana', NUEVA.pub)).toBe(true);
  });

  /**
   * La distinción que D2 pide de verdad. Preguntar por Ana antes de que
   * reinstalara no dice NADA sobre la clave de su teléfono nuevo.
   */
  it('una respuesta anterior a esta clave no cuenta como haber preguntado por ella', async () => {
    await refreshAuthorKeys('ana');                 // consulta vieja, por el autor
    expect(authorKeyWasAsked('ana', NUEVA.pub)).toBe(false);
  });

  it('un directorio que se cae no cuenta como respuesta', async () => {
    mockFetchAccountKeys.mockRejectedValue(new Error('sin red'));
    authorKeysFor('ana', NUEVA.pub);
    await refreshPendingAuthors();
    expect(authorKeyWasAsked('ana', NUEVA.pub)).toBe(false);
  });

  it('una consulta frenada por el cooldown tampoco es una respuesta', async () => {
    await refreshAuthorKeys('ana');                 // arranca el cooldown
    authorKeysFor('ana', NUEVA.pub);
    await refreshPendingAuthors();                  // no sale: cooldown
    expect(mockFetchAccountKeys).toHaveBeenCalledTimes(1);
    expect(authorKeyWasAsked('ana', NUEVA.pub)).toBe(false);
  });

  it('una clave que la resolución ya cubre no queda “preguntada” sin razón', () => {
    authorKeysFor('ana', VIEJA.pub);
    expect(authorKeyWasAsked('ana', VIEJA.pub)).toBe(false);
  });

  it('cambiar de cuenta olvida lo preguntado: no es un dato de la nueva', async () => {
    authorKeysFor('ana', NUEVA.pub);
    await refreshPendingAuthors();
    expect(authorKeyWasAsked('ana', NUEVA.pub)).toBe(true);

    reloadAuthorKeys();
    expect(authorKeyWasAsked('ana', NUEVA.pub)).toBe(false);
  });
});
