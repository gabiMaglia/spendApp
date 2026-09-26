import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  unirDisputa, enDisputa, normalizarDisputa, MAX_AUTORIA_DISPUTADA, MAX_LARGO_ID_DISPUTA,
} from '@/src/algorithms/autoria';

describe('unirDisputa (D-2)', () => {
  it('mismo autor y sin disputa previa: no hay campo', () => {
    expect(unirDisputa(undefined, undefined, 'ana', 'ana')).toBeUndefined();
  });

  it('autores distintos: entran los dos, ordenados', () => {
    expect(unirDisputa(undefined, undefined, 'mallory', 'ana')).toEqual(['ana', 'mallory']);
  });

  it('une lo que traen los dos lados aunque el autor coincida', () => {
    expect(unirDisputa(['ana', 'mallory'], ['carla', 'ana'], 'ana', 'ana'))
      .toEqual(['ana', 'carla', 'mallory']);
  });

  it('devuelve la MISMA referencia cuando no cambia (sin re-render por drenado)', () => {
    const local = ['ana', 'mallory'];
    expect(unirDisputa(local, ['mallory'], 'mallory', 'ana')).toBe(local);
  });

  it('es conmutativa, asociativa e idempotente', () => {
    const a = ['ana']; const b = ['mallory', 'beto']; const c = ['carla'];
    expect(unirDisputa(a, b, 'x', 'x')).toEqual(unirDisputa(b, a, 'x', 'x'));
    const ab = unirDisputa(a, b, 'x', 'x');
    expect(unirDisputa(ab, c, 'x', 'x')).toEqual(unirDisputa(a, unirDisputa(b, c, 'x', 'x'), 'x', 'x'));
    expect(unirDisputa(ab, ab, 'x', 'x')).toEqual(ab);
  });

  it('descarta lo que no es un id: no-string, vacío, demasiado largo', () => {
    const largo = 'x'.repeat(MAX_LARGO_ID_DISPUTA + 1);
    expect(unirDisputa([1 as never, '', largo], ['ana'], 'ana', 'ana')).toEqual(['ana']);
  });

  it('tope determinista: se queda con los N menores', () => {
    const muchos = Array.from({ length: 20 }, (_, i) => `u${String(i).padStart(2, '0')}`);
    expect(unirDisputa(muchos.slice(10), muchos.slice(0, 10), 'u00', 'u00'))
      .toEqual(muchos.slice(0, MAX_AUTORIA_DISPUTADA));
  });

  it('una lista que queda vacía normaliza a «sin campo» (converge [] con undefined)', () => {
    expect(unirDisputa([], undefined, 'ana', 'ana')).toBeUndefined();
  });
});

describe('enDisputa', () => {
  it('sin campo o con un solo id no hay disputa', () => {
    expect(enDisputa({})).toBe(false);
    expect(enDisputa({ autoriaDisputada: ['ana'] })).toBe(false);
  });

  it('con dos ids distintos hay disputa', () => {
    expect(enDisputa({ autoriaDisputada: ['ana', 'mallory'] })).toBe(true);
  });

  it('cuenta sobre lo normalizado: la basura y los repetidos no hacen disputa', () => {
    expect(enDisputa({ autoriaDisputada: ['ana', 'x'.repeat(500)] })).toBe(false);
    expect(enDisputa({ autoriaDisputada: ['ana', 'ana'] })).toBe(false);
    expect(normalizarDisputa('no-es-array')).toEqual([]);
  });
});

it('I-1: el módulo es puro — no importa nada con valor en runtime', () => {
  const src = readFileSync(resolve(__dirname, '../autoria.ts'), 'utf8');
  const imports = [...src.matchAll(/^import (?!type )[^;]*from '([^']+)'/gm)].map(m => m[1]);
  expect(imports).toEqual([]);
});
