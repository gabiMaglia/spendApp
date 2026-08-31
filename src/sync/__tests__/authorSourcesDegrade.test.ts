import {
  resolveAuthorKeys, authorKeysFor, refreshAuthorKeys, pendingAuthorRefreshes,
  rememberAuthorKey, forgetAuthorKeys, __resetAuthorSources,
} from '../authorKeys';
import { useAuthStore } from '@/src/store/authStore';
import type { User } from '@/src/types/models';

/**
 * S4 de T-041: **la ausencia de una fuente degrada, no rompe.**
 *
 * `contactChannel` arrastra `expo-crypto`, que es un módulo nativo, y este
 * archivo lo importa el merge — o sea, el camino del sync. Un import arriba de
 * todo lo vuelve inutilizable en un build que no traiga ese binario, y eso no
 * falla en la pantalla: falla en el ARRANQUE. Ya pasó en este proyecto, y es lo
 * que `hexBytes.ts` documenta.
 *
 * **Por qué este archivo existe aparte.** La primera versión probaba esto con
 * `jest.doMock` adentro de `jest.isolateModules`, en el archivo de al lado. El
 * mock no pisaba al `jest.mock` hoisteado de ese archivo: el require devolvía el
 * módulo bueno y el test pasaba **con la degradación rota**. Lo encontró el
 * meta-test de mutación —sacarle el `try/catch` a la carga no tumbaba nada— y no
 * la lectura del test, que se veía correcta. Acá los módulos están rotos desde
 * el require hoisteado, que es la única forma de que el fallo sea real.
 */

jest.mock('../contactChannel', () => { throw new Error('módulo nativo ausente'); });
jest.mock('../deviceKeys', () => { throw new Error('módulo nativo ausente'); });

const K = 'a'.repeat(64);

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: 'yo' } as User });
  forgetAuthorKeys();
  __resetAuthorSources();
});

it('sin el módulo de peers, las otras fuentes siguen resolviendo', () => {
  rememberAuthorKey('ana', K);

  expect(resolveAuthorKeys('ana')).toEqual([K]);
});

it('sin ninguna fuente cargable, la resolución es vacía y no tira', () => {
  expect(resolveAuthorKeys('ana')).toEqual([]);
  expect(authorKeysFor('ana', K)).toEqual([]);
});

it('y el autor igual queda encolado: la falta de una fuente no se lleva la consulta', () => {
  authorKeysFor('ana', K);

  expect(pendingAuthorRefreshes()).toEqual(['ana']);
});

it('sin el módulo del directorio, el refresco devuelve vacío en vez de romper', async () => {
  await expect(refreshAuthorKeys('ana')).resolves.toEqual([]);
});
