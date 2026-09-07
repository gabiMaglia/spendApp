import { installGlobalErrorHandler, __resetGlobalErrorHandler } from '../globalErrorHandler';
import { listErrors } from '../errorLog';
import { createSecureStorage } from '@/src/utils/secureStorage';

/**
 * T-078 · Lo que se rompe fuera de React.
 *
 * `ErrorUtils` es API INTERNA de React Native y ha cambiado entre versiones —
 * en 0.81 la define `@react-native/js-polyfills/error-guard.js` como global,
 * pero no hay garantía de que siga. Por eso los dos casos que importan acá no
 * son "anota el error" sino:
 *
 *  1. **si no está, es un no-op** — un diagnóstico que tumbe el arranque por no
 *     encontrar un global sería peor que no tener diagnóstico;
 *  2. **se delega SIEMPRE en el handler anterior** — reemplazarlo sin llamarlo
 *     cambia el comportamiento por default de RN, incluida la pantalla roja de
 *     desarrollo. Este módulo observa, no interviene.
 */
type Handler = (error: unknown, isFatal?: boolean) => void;

const g = globalThis as { ErrorUtils?: unknown };
let original: unknown;

beforeEach(() => {
  createSecureStorage('notices').clearAll();
  __resetGlobalErrorHandler();
  original = g.ErrorUtils;
});

afterEach(() => {
  g.ErrorUtils = original;
  __resetGlobalErrorHandler();
});

/** Un `ErrorUtils` de mentira con el que se puede disparar el handler. */
function fingirErrorUtils(previo?: Handler) {
  let actual: Handler | undefined = previo;
  g.ErrorUtils = {
    setGlobalHandler: (h: Handler) => { actual = h; },
    getGlobalHandler: () => actual,
  };
  return { disparar: (e: unknown, fatal?: boolean) => actual?.(e, fatal) };
}

describe('sin ErrorUtils', () => {
  it('no lanza y avisa que no se instaló', () => {
    delete g.ErrorUtils;
    expect(installGlobalErrorHandler()).toBe(false);
  });

  it('con un ErrorUtils sin `setGlobalHandler` tampoco lanza', () => {
    g.ErrorUtils = {};
    expect(installGlobalErrorHandler()).toBe(false);
  });
});

describe('con ErrorUtils', () => {
  it('anota el error que llega de afuera de React', () => {
    const { disparar } = fingirErrorUtils();
    installGlobalErrorHandler();

    disparar(Object.assign(new Error('explotó un timer'), { stack: 'at timer' }), true);

    expect(listErrors()[0]).toMatchObject({
      message: 'explotó un timer', stack: 'at timer', fatal: true,
    });
  });

  it('un error NO fatal se anota como no fatal', () => {
    const { disparar } = fingirErrorUtils();
    installGlobalErrorHandler();

    disparar(new Error('molesto pero no fatal'), false);

    expect(listErrors()[0]!.fatal).toBe(false);
  });

  it('lo que se tira no es un Error igual se anota', () => {
    // `throw 'texto'` es legal en JS y llega acá como string.
    const { disparar } = fingirErrorUtils();
    installGlobalErrorHandler();

    disparar('un string pelado', true);

    expect(listErrors()[0]!.message).toBe('un string pelado');
  });

  it('delega SIEMPRE en el handler anterior', () => {
    const previo = jest.fn();
    const { disparar } = fingirErrorUtils(previo);
    installGlobalErrorHandler();

    const err = new Error('boom');
    disparar(err, true);

    expect(previo).toHaveBeenCalledWith(err, true);
  });

  it('si el handler anterior tira, el nuestro no se cae con él', () => {
    const previo = jest.fn(() => { throw new Error('el de antes está roto'); });
    const { disparar } = fingirErrorUtils(previo);
    installGlobalErrorHandler();

    expect(() => disparar(new Error('boom'), true)).not.toThrow();
    expect(listErrors()).toHaveLength(1);
  });

  it('instalarlo dos veces no encadena dos handlers', () => {
    // Con fast refresh esto se importa muchas veces por sesión; sin el guard,
    // cada recarga agregaría una copia y el mismo error se anotaría N veces.
    const { disparar } = fingirErrorUtils();
    installGlobalErrorHandler();
    installGlobalErrorHandler();

    disparar(new Error('boom'), true);

    expect(listErrors()).toHaveLength(1);
  });
});
