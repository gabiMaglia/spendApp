import { createSecureStorage } from '@/src/utils/secureStorage';
import { ensureOwnerPledge } from '@/src/store/identityStore';
import { prendaDelAparato, olvidarPrendaEnCache } from '../ownerPledge';

/**
 * T-088 · La prenda de escritura del buzón (ADR-009 D-1).
 *
 * Dos propiedades sostienen todo el diseño y las dos se rompen en silencio:
 *  1. el `proof` que viaja es `sha256(secret)` **igual que lo calcularía
 *     `digest()` de pgcrypto** — si los dos lados no coinciden,
 *     `delete_my_envelopes` devuelve siempre 0 y nadie se entera;
 *  2. no tener prenda **no bloquea publicar** — un sobre sin prenda se comporta
 *     como los de antes de este ticket.
 */
describe('la prenda del aparato', () => {
  beforeEach(() => {
    createSecureStorage('groupkeys').clearAll();
    olvidarPrendaEnCache();
  });

  it('son dos valores distintos, de 32 bytes cada uno', () => {
    const { secret, proof } = ensureOwnerPledge();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(proof).toMatch(/^[0-9a-f]{64}$/);
    expect(proof).not.toBe(secret);
  });

  it('es estable: leer-o-crear, no crear-siempre', () => {
    // Si cambiara en cada llamada, cada publicación estamparía una prenda
    // distinta y no se podría borrar nada.
    expect(ensureOwnerPledge().secret).toBe(ensureOwnerPledge().secret);
  });

  it('sobrevive al reinicio: está persistida', () => {
    const { secret } = ensureOwnerPledge();
    expect(createSecureStorage('groupkeys').getString('owner_secret_v1')).toContain(secret);
  });

  it('un storage corrupto regenera en vez de romper', () => {
    createSecureStorage('groupkeys').set('owner_secret_v1', '{roto');
    expect(() => ensureOwnerPledge()).not.toThrow();
    expect(ensureOwnerPledge().secret).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * EL TEST QUE IMPORTA. El vector va escrito literal, calculado aparte: si se
   * escribiera llamando otra vez a `sha256`, probaría que la función es igual a
   * sí misma y no que el servidor va a derivar la misma tag.
   *
   * `encode(digest(<texto>,'sha256'),'hex')` de pgcrypto hashea los bytes UTF-8
   * del texto; el secreto es hex ASCII, así que las dos cuentas tienen que dar
   * lo mismo. La confirmación cruzada contra Postgres es el paso (1) de la
   * prueba funcional de `engram/plans/T-087.md` §7.
   */
  it('el acceso perezoso devuelve la misma prenda que el store', () => {
    expect(prendaDelAparato()?.secret).toBe(ensureOwnerPledge().secret);
  });
});

/**
 * EL TEST QUE IMPORTA. El vector va escrito literal, calculado fuera de este
 * código: si se escribiera llamando otra vez a `sha256`, probaría que la
 * función es igual a sí misma y no que el servidor va a derivar la misma tag.
 *
 * `encode(digest(<texto>,'sha256'),'hex')` de pgcrypto hashea los bytes UTF-8
 * del texto; el secreto es hex ASCII, así que las dos cuentas tienen que dar lo
 * mismo. Si no coinciden, `delete_my_envelopes` devuelve siempre 0 y el ticket
 * no cumple. La confirmación cruzada contra Postgres es el paso (1) de la
 * prueba funcional de `engram/plans/T-087.md` §7.
 */
describe('la cuenta del hash coincide con la del servidor', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('expo-crypto');
  });

  it('con 32 bytes en cero, el proof es el vector conocido', () => {
    jest.resetModules();
    jest.doMock('expo-crypto', () => ({
      ...jest.requireActual('expo-crypto'),
      getRandomBytes: () => new Uint8Array(32),   // ⇒ secret = 64 ceros ASCII
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const storage = require('@/src/utils/secureStorage') as typeof import('@/src/utils/secureStorage');
    storage.createSecureStorage('groupkeys').clearAll();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const store = require('@/src/store/identityStore') as typeof import('@/src/store/identityStore');

    const { secret, proof } = store.ensureOwnerPledge();
    expect(secret).toBe('0'.repeat(64));
    // sha256 de esos 64 caracteres ASCII.
    expect(proof).toBe('60e05bd1b195af2f94112fa7197a5c88289058840ce7c6df9693756bc6250f55');
  });
});

describe('cuando la identidad no se puede tocar', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('@/src/store/identityStore');
  });

  it('devuelve null sin lanzar si el módulo no carga', () => {
    jest.resetModules();
    jest.doMock('@/src/store/identityStore', () => {
      throw new Error('nativo ausente');
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../ownerPledge') as typeof import('../ownerPledge');
    expect(mod.prendaDelAparato()).toBeNull();
  });

  it('devuelve null sin lanzar si la generación falla', () => {
    jest.resetModules();
    jest.doMock('@/src/store/identityStore', () => ({
      ensureOwnerPledge: () => { throw new Error('storage cifrado que no abrió'); },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../ownerPledge') as typeof import('../ownerPledge');
    expect(mod.prendaDelAparato()).toBeNull();
  });
});
