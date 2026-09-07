import {
  recordError, listErrors, clearErrors, serializeErrorLog,
  diagnosticoFileName, MAX_ENTRIES, FORMATO_DIAGNOSTICO,
} from '../errorLog';
import { createSecureStorage } from '@/src/utils/secureStorage';

/**
 * T-078 · El registro local de errores.
 *
 * Las dos propiedades que se rompen en silencio, y por eso están acá:
 * **`recordError` no puede lanzar nunca** —es lo que corre cuando algo ya salió
 * mal, así que si tirara convertiría un error contenido en uno que se lleva
 * puesto al manejador— y **el anillo tiene tope**, porque un stack de React
 * Native puede pesar varios KB y esto se guarda entero en cada escritura.
 */
const storage = createSecureStorage('notices');

beforeEach(() => {
  storage.clearAll();
});

describe('anotar y leer', () => {
  it('guarda el error y lo devuelve', () => {
    recordError({ message: 'boom', stack: 'at foo', fatal: true });

    const [e] = listErrors();
    expect(e).toMatchObject({ message: 'boom', stack: 'at foo', fatal: true });
    expect(typeof e!.at).toBe('number');
  });

  it('devuelve el más nuevo primero', () => {
    recordError({ message: 'viejo', fatal: false });
    recordError({ message: 'nuevo', fatal: false });

    expect(listErrors().map(e => e.message)).toEqual(['nuevo', 'viejo']);
  });

  it('sin errores devuelve una lista vacía, no explota', () => {
    expect(listErrors()).toEqual([]);
  });

  it('`clearErrors` deja la lista vacía', () => {
    recordError({ message: 'boom', fatal: true });
    clearErrors();
    expect(listErrors()).toEqual([]);
  });
});

describe('el anillo tiene tope', () => {
  it(`el ${MAX_ENTRIES + 1} empuja al primero`, () => {
    for (let i = 0; i <= MAX_ENTRIES; i++) recordError({ message: `e${i}`, fatal: false });

    const lista = listErrors();
    expect(lista).toHaveLength(MAX_ENTRIES);
    expect(lista[0]!.message).toBe(`e${MAX_ENTRIES}`);          // el último anotado
    expect(lista.map(e => e.message)).not.toContain('e0');      // el primero se cayó
  });

  it('un stack gigante se recorta en vez de guardarse entero', () => {
    // Sin esto, `MAX_ENTRIES` no acota nada: 50 stacks de 50 KB son 2,5 MB en
    // una clave que se lee y se reescribe en cada error.
    recordError({ message: 'boom', stack: 'x'.repeat(50_000), fatal: true });

    const guardado = listErrors()[0]!.stack!;
    expect(guardado.length).toBeLessThan(5_000);
    expect(guardado).toMatch(/caracteres más/);
  });
});

describe('no puede ser una fuente de errores', () => {
  it('con el storage roto, `recordError` NO lanza', () => {
    const set = jest.spyOn(storage, 'set').mockImplementation(() => {
      throw new Error('storage caído');
    });

    expect(() => recordError({ message: 'boom', fatal: true })).not.toThrow();

    set.mockRestore();
  });

  it('con el registro corrupto, `listErrors` devuelve vacío en vez de tirar', () => {
    storage.set('error_log_v1', '{esto no es json');
    expect(listErrors()).toEqual([]);

    // Y se puede seguir anotando encima de la basura.
    expect(() => recordError({ message: 'después', fatal: false })).not.toThrow();
    expect(listErrors().map(e => e.message)).toEqual(['después']);
  });
});

describe('el archivo que se exporta', () => {
  it('es JSON parseable, versionado, con los errores adentro', () => {
    recordError({ message: 'boom', fatal: true });

    const d = JSON.parse(serializeErrorLog()) as {
      v: number; app: string; platform: string; errors: { message: string }[];
    };

    expect(d.v).toBe(FORMATO_DIAGNOSTICO);
    expect(d.errors.map(e => e.message)).toEqual(['boom']);
    // La versión de la app es el primer dato que se mira en un reporte de otro
    // teléfono; sin ella el stack no dice contra qué build corrió.
    expect(typeof d.app).toBe('string');
    expect(typeof d.platform).toBe('string');
  });

  it('el nombre del archivo lleva fecha, así dos exportaciones no se pisan', () => {
    expect(diagnosticoFileName()).toMatch(/^spendapp-diagnostico-\d{8}-\d{4}\.json$/);
  });
});
