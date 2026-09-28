import {
  knownAuthorKeys, rememberAuthorKey, forgetAuthorKeys, reloadAuthorKeys,
  AUTHOR_KEYS_CACHE_KEY, AUTHOR_KEYS_MAX_PER_AUTHOR,
} from '../authorKeys';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { writeScoped } from '@/src/store/userScope';
import { useAuthStore } from '@/src/store/authStore';
import type { User } from '@/src/types/models';

/**
 * S3 de T-041: la caché de públicas ya resueltas (fuente 3 del §2).
 *
 * Es una API **síncrona y sin red**, porque el único lugar donde se consulta es
 * el merge, y `applyDelta` es síncrono (§3). La unión con las otras dos fuentes
 * —registro local de peers y directorio por cuenta— y el refresco fuera de
 * banda son S4.
 *
 * **No es un acumulador TOFU.** Acá no se guarda una clave por el sólo hecho de
 * que un registro haya verificado contra ella: eso dejaría que el primer
 * registro hostil de un autor desconocido siembre la clave del atacante y a
 * partir de ahí todo lo suyo dé `valida`. Se guarda lo que otra fuente ya
 * resolvió.
 */

const storage = createSecureStorage('users');
const K1 = 'a'.repeat(64);
const K2 = 'b'.repeat(64);

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: 'yo' } as User });
  forgetAuthorKeys();
});

describe('guardar y leer', () => {
  it('lo que se recuerda se lee', () => {
    rememberAuthorKey('ana', K1);
    expect(knownAuthorKeys('ana')).toEqual([K1]);
  });

  it('un autor del que no sabemos nada da lista vacía, no explota', () => {
    expect(knownAuthorKeys('nadie')).toEqual([]);
    expect(knownAuthorKeys('')).toEqual([]);
  });

  it('un autor no ve las claves de otro', () => {
    rememberAuthorKey('ana', K1);
    expect(knownAuthorKeys('beto')).toEqual([]);
  });

  it('la misma clave dos veces no se duplica', () => {
    rememberAuthorKey('ana', K1);
    rememberAuthorKey('ana', K1);
    expect(knownAuthorKeys('ana')).toEqual([K1]);
  });

  /**
   * Una persona puede tener más de un teléfono, y la clave es del APARATO
   * (`identityStore.ts`: no se scopea por cuenta). Quedarse con una sola
   * rechazaría los registros del segundo aparato.
   */
  it('un autor puede tener varias claves', () => {
    rememberAuthorKey('ana', K1);
    rememberAuthorKey('ana', K2);
    expect([...knownAuthorKeys('ana')].sort()).toEqual([K1, K2].sort());
  });

  it('no crece sin techo por autor', () => {
    for (let i = 0; i < AUTHOR_KEYS_MAX_PER_AUTHOR + 5; i++) {
      rememberAuthorKey('ana', i.toString(16).padStart(64, '0'));
    }
    expect(knownAuthorKeys('ana')).toHaveLength(AUTHOR_KEYS_MAX_PER_AUTHOR);
  });
});

describe('fail-closed: una caché rota da MENOS claves, nunca una de más', () => {
  it.each([
    ['no es hex', 'z'.repeat(64)],
    ['corta', 'ab'],
    ['larga', 'a'.repeat(66)],
    ['vacía', ''],
  ])('una clave %s no se guarda', (_caso, mala) => {
    rememberAuthorKey('ana', mala);
    expect(knownAuthorKeys('ana')).toEqual([]);
  });

  it('JSON corrupto en disco ⇒ vacía', () => {
    rememberAuthorKey('ana', K1);
    writeScoped(storage, AUTHOR_KEYS_CACHE_KEY, '{{{ no parsea');
    reloadAuthorKeys();
    expect(knownAuthorKeys('ana')).toEqual([]);
  });

  it.each([
    ['null', 'null'],
    ['una lista', '[]'],
    ['texto', '"hola"'],
    ['valores que no son listas', '{"ana":"' + 'a'.repeat(64) + '"}'],
    ['una lista de basura', '{"ana":[1,null,{}]}'],
  ])('estructura %s en disco ⇒ vacía', (_caso, basura) => {
    writeScoped(storage, AUTHOR_KEYS_CACHE_KEY, basura);
    reloadAuthorKeys();
    expect(knownAuthorKeys('ana')).toEqual([]);
  });

  it('una entrada podrida no contamina a las sanas', () => {
    writeScoped(storage, AUTHOR_KEYS_CACHE_KEY,
      JSON.stringify({ ana: [K1, 'basura'], beto: 'no-es-lista' }));
    reloadAuthorKeys();

    expect(knownAuthorKeys('ana')).toEqual([K1]);
    expect(knownAuthorKeys('beto')).toEqual([]);
  });
});

describe('persistencia', () => {
  it('sobrevive al reinicio del proceso', () => {
    rememberAuthorKey('ana', K1);
    reloadAuthorKeys();
    expect(knownAuthorKeys('ana')).toEqual([K1]);
  });

  it('está scopeada por cuenta', () => {
    rememberAuthorKey('ana', K1);

    useAuthStore.setState({ currentUser: { id: 'otra-cuenta' } as User });
    reloadAuthorKeys();
    expect(knownAuthorKeys('ana')).toEqual([]);

    useAuthStore.setState({ currentUser: { id: 'yo' } as User });
    reloadAuthorKeys();
    expect(knownAuthorKeys('ana')).toEqual([K1]);
  });
});
