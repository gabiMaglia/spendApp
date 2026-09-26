import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  unirDisputa, normalizarDisputa, MAX_AUTORIA_DISPUTADA, MAX_LARGO_ID_DISPUTA,
} from '@/src/algorithms/autoria';
import type { NucleoDisputado } from '@/src/types/models';

/**
 * T-170 · D-2, enmienda de disputa firmada — ronda 2 (dictamen del
 * verificador: inyectar un id suelto sin tocar el núcleo abría una disputa
 * irreversible y anónima). `autoriaDisputada` deja de ser un `string[]` y
 * pasa a ser un array de NÚCLEOS COMPETIDORES con su firma
 * (`NucleoDisputado`). El merge sigue sin verificar nada (D9): sólo filtra
 * por FORMA y une por CONTENIDO — la verificación de verdad vive afuera
 * (`src/sync/autoriaTrust.ts`, `enDisputa`).
 */

const nucleo = (over: Partial<NucleoDisputado> = {}): NucleoDisputado => ({
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 1_000, currency: 'ARS',
  paidById: 'ana', payers: [], splits: [], splitMode: 'equal', category: 'food',
  date: 0, createdAt: 0, createdById: 'ana', note: '', rev: 1,
  k: 'aa'.repeat(32), s: 'bb'.repeat(64),
  ...over,
});

const registro = (createdById: string, over: Partial<NucleoDisputado> = {}) =>
  nucleo({ createdById, ...over }) as unknown as Record<string, unknown>;

describe('unirDisputa (D-2, ronda 2 — núcleos firmados)', () => {
  it('mismo autor y sin disputa previa: no hay campo', () => {
    expect(unirDisputa(undefined, undefined, registro('ana'), registro('ana'))).toBeUndefined();
  });

  it('autores distintos, los dos con firma: se capturan los dos núcleos', () => {
    const local = registro('ana', { k: 'aa'.repeat(32), s: '11'.repeat(64) });
    const remoto = registro('mallory', { rev: 2, k: 'cc'.repeat(32), s: '22'.repeat(64) });

    const out = unirDisputa(undefined, undefined, local, remoto)!;
    expect(out.map(e => e.createdById).sort()).toEqual(['ana', 'mallory']);
    // La entrada preserva la firma de CADA lado, no una mezcla.
    expect(out.find(e => e.createdById === 'mallory')!.s).toBe('22'.repeat(64));
    expect(out.find(e => e.createdById === 'ana')!.s).toBe('11'.repeat(64));
  });

  it('el lado sin firma (sin k/s) no se puede capturar: sólo entra el que firmó', () => {
    const local = registro('ana', { k: '', s: '' }); // gasto anterior a T-041, sin firmar
    const remoto = registro('mallory', { rev: 2 });

    const out = unirDisputa(undefined, undefined, local, remoto)!;
    expect(out.map(e => e.createdById)).toEqual(['mallory']);
  });

  it('ninguno de los dos firmó: no hay nada capturable, no hay disputa', () => {
    const local = registro('ana', { k: '', s: '' });
    const remoto = registro('mallory', { rev: 2, k: '', s: '' });
    expect(unirDisputa(undefined, undefined, local, remoto)).toBeUndefined();
  });

  it('une lo que traen los dos lados aunque el registro actual coincida en autor', () => {
    const a = [nucleo({ createdById: 'ana' })];
    const b = [nucleo({ createdById: 'carla', rev: 3, k: 'dd'.repeat(32), s: '33'.repeat(64) })];
    const out = unirDisputa(a, b, registro('x'), registro('x'))!;
    expect(out.map(e => e.createdById).sort()).toEqual(['ana', 'carla']);
  });

  it('devuelve la MISMA referencia cuando no cambia (sin re-render por drenado)', () => {
    const local = [nucleo({ createdById: 'ana' }), nucleo({ createdById: 'mallory', rev: 2 })];
    // El remoto trae exactamente lo mismo (por contenido) y el registro actual
    // coincide en autor: no hay nada nuevo que agregar.
    expect(unirDisputa(local, [nucleo({ createdById: 'mallory', rev: 2 })], registro('x'), registro('x')))
      .toBe(local);
  });

  it('es conmutativa: el orden de llegada no cambia el resultado (por contenido)', () => {
    const a = [nucleo({ createdById: 'ana' })];
    const b = [nucleo({ createdById: 'mallory', rev: 2, k: 'cc'.repeat(32), s: '22'.repeat(64) })];
    const ab = unirDisputa(a, b, registro('x'), registro('x'));
    const ba = unirDisputa(b, a, registro('x'), registro('x'));
    expect(ab).toEqual(ba);
  });

  it('descarta lo que no tiene forma de núcleo firmado: sin firma, sin id, o campos truncados', () => {
    const conBasura = [
      { createdById: 'x' }, // sin k/s/rev/id: no es un núcleo
      nucleo({ createdById: 'zzz'.repeat(60) }), // id demasiado largo
      nucleo({ createdById: 'yyy', k: 'no-es-hex' }),
      { createdById: '', k: 'aa'.repeat(32), s: 'bb'.repeat(64), rev: 1, id: 'e1' },
    ] as unknown[];
    expect(normalizarDisputa(conBasura)).toEqual([]);
  });

  it('inyectar SÓLO un id (ronda 1, ya cerrada): no tiene forma de núcleo y se descarta', () => {
    expect(normalizarDisputa(['ana', 'mallory'])).toEqual([]);
  });

  it('tope determinista de cantidad (G9)', () => {
    const muchos = Array.from({ length: 20 }, (_, i) =>
      nucleo({ createdById: `u${String(i).padStart(2, '0')}`, rev: i, k: `${i}`.padStart(2, '0').repeat(32), s: 'ff'.repeat(64) }));
    expect(normalizarDisputa(muchos).length).toBe(MAX_AUTORIA_DISPUTADA);
  });

  it('una lista que queda vacía normaliza a «sin campo» (converge [] con undefined)', () => {
    expect(unirDisputa([], undefined, registro('ana'), registro('ana'))).toBeUndefined();
  });

  it('MAX_LARGO_ID_DISPUTA sigue acotando el largo del id', () => {
    const largo = nucleo({ createdById: 'x'.repeat(MAX_LARGO_ID_DISPUTA + 1) });
    expect(normalizarDisputa([largo])).toEqual([]);
  });
});

it('I-1: el módulo no importa crypto ni estado con el que verificaría firmas — el merge no puede tocar la curva (D9)', () => {
  const src = readFileSync(resolve(__dirname, '../autoria.ts'), 'utf8');
  const imports = [...src.matchAll(/^import (?!type )[^;]*from '([^']+)'/gm)].map(m => m[1]);
  const prohibidos = ['@noble', 'recordSign', 'verdictCache', 'trustCheck', 'syncedClock', 'identityAlias', 'authorKeys'];
  for (const imp of imports) {
    expect(prohibidos.some(p => imp.includes(p))).toBe(false);
  }
});
