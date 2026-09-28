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
 *
 * Los casos de "el módulo de identidad no se puede tocar en absoluto" viven en
 * `ownerPledgeModuloAusente.test.ts` y `ownerPledgeGeneracionFalla.test.ts`,
 * separados por la misma razón que separa `authorSourcesDegrade.test.ts` de
 * `authorResolve.test.ts` (ver el docblock de ese archivo, T-173/S4): un
 * `jest.doMock` dinámico — con o sin `jest.isolateModules` — no pisa el
 * `require`/import ya resuelto en ESTE archivo; sólo un `jest.mock` hoisteado
 * desde el arranque de un archivo dedicado garantiza que el módulo esté roto
 * quien sea que lo pida.
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
   *
   * T-173: antes comparaba contra el `ensureOwnerPledge` importado ESTÁTICO de
   * arriba del archivo. Bajo `--randomize`, si un test de OTRO archivo — no,
   * de ESTE mismo archivo (ver más abajo) — corría antes y dejaba el registro
   * de módulos de Jest reseteado, el `require` perezoso de `prendaDelAparato()`
   * resolvía una instancia de `identityStore` (y de su storage) DISTINTA de la
   * que usa el import estático: dos módulos, dos storages, dos secretos random
   * — nunca iguales. La comparación tiene que hacerse contra un `require` del
   * MISMO módulo, tomado en el mismo instante: así, esté el registro reseteado
   * o no, las dos mitades leen la misma instancia.
   */
  it('el acceso perezoso devuelve la misma prenda que el store', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const identidadActual = require('@/src/store/identityStore') as typeof import('@/src/store/identityStore');
    expect(prendaDelAparato()?.secret).toBe(identidadActual.ensureOwnerPledge().secret);
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
// Bandera mutable + `jest.mock` HOISTEADO (no `jest.doMock` dinámico, T-173):
// pisa el mock de `expo-crypto` de `src/test-utils/setup.ts` para TODO este
// archivo, replicando su comportamiento salvo cuando se pide el vector fijo.
// Sin esto, un `jest.resetModules()` en este describe volvía a divergir el
// registro de módulos del archivo (mismo bug que el test de arriba).
let mockForzarCeros = false;
jest.mock('expo-crypto', () => {
  let mockSeed = 1;
  return {
    getRandomBytesAsync: async (n: number) =>
      new Uint8Array(Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256)),
    getRandomBytes: (n: number) => {
      if (mockForzarCeros) return new Uint8Array(n);
      return new Uint8Array(Array.from({ length: n }, () => {
        mockSeed = (mockSeed * 1103515245 + 12345) & 0x7fffffff;
        return mockSeed % 256;
      }));
    },
    digestStringAsync: async (_alg: string, data: string) => {
      let h1 = 0x811c9dc5, h2 = 0x01000193;
      for (let i = 0; i < data.length; i++) {
        h1 = ((h1 ^ data.charCodeAt(i)) * 16777619) >>> 0;
        h2 = ((h2 + data.charCodeAt(i) * (i + 1)) * 2654435761) >>> 0;
      }
      return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(4);
    },
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  };
});

describe('la cuenta del hash coincide con la del servidor', () => {
  afterEach(() => { mockForzarCeros = false; });

  it('con 32 bytes en cero, el proof es el vector conocido', () => {
    mockForzarCeros = true;
    createSecureStorage('groupkeys').clearAll();

    const { secret, proof } = ensureOwnerPledge();
    expect(secret).toBe('0'.repeat(64));
    // sha256 de esos 64 caracteres ASCII.
    expect(proof).toBe('60e05bd1b195af2f94112fa7197a5c88289058840ce7c6df9693756bc6250f55');
  });
});
