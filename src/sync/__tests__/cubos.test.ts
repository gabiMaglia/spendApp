import * as Crypto from 'expo-crypto';
import { prefijoDe, cubosDe, profundidadNecesaria, jsonDeCubo, SPLIT_BYTES } from '../relay/cubos';

/**
 * T-191 Task 1 — cubos por prefijo de id + JSON determinista (spec §2.1, §7 C1/C3).
 *
 * Tabla del plan (engram/plans/T-191.md, Task 1): P1, P2, P3, P4, P5, P14, P18.
 * P14 (ckey opaca entre grupos) ya está cubierto por `slices.test.ts` — la
 * fórmula de `deriveCkey` no cambió, sólo el significado del tercer
 * argumento (índice → prefijo), y ese test ya prueba que la clave del grupo
 * participa del hash.
 */

function id(i: number): string {
  return `e${String(i).padStart(6, '0')}`; // no-UUID a propósito: ejercita la rama sha256
}

function uuid(i: number): string {
  const hex = i.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

describe('prefijoDe', () => {
  it('P2: id no-UUID va al prefijo de sha256(id), y es determinística', async () => {
    const esperado = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, 'no-es-un-uuid')).slice(0, 2);
    const a = await prefijoDe('no-es-un-uuid', 2);
    const b = await prefijoDe('no-es-un-uuid', 2);
    expect(a).toBe(esperado);
    expect(a).toBe(b);
  });

  it('un UUID usa sus propios primeros dígitos hex, sin hashear', async () => {
    const u = uuid(0xabc123);
    const p = await prefijoDe(u, 4);
    expect(p).toBe(u.replace(/-/g, '').slice(0, 4));
  });

  it('UUID en mayúsculas se trata igual que en minúsculas', async () => {
    const u = uuid(0xdead);
    const minuscula = await prefijoDe(u, 4);
    const mayuscula = await prefijoDe(u.toUpperCase(), 4);
    expect(mayuscula).toBe(minuscula);
  });
});

describe('cubosDe — P1', () => {
  it('300 gastos a d=1: ≤16 cubos, cada uno < SPLIT, ningún id repetido, unión = todos', async () => {
    const relleno = 'x'.repeat(300); // cubos livianos: no fuerza profundidad > 1
    const registros = Array.from({ length: 300 }, (_, i) => ({ id: id(i), relleno }));
    const cubos = await cubosDe(registros, 1);

    expect(cubos.size).toBeLessThanOrEqual(16);

    const vistos = new Set<string>();
    for (const [, lista] of cubos) {
      expect(Buffer.byteLength(JSON.stringify(lista), 'utf8')).toBeLessThan(SPLIT_BYTES);
      for (const r of lista) {
        expect(vistos.has(r.id)).toBe(false); // ningún id en dos cubos
        vistos.add(r.id);
      }
    }
    expect(vistos.size).toBe(300);
  });

  it('dentro de cada cubo, los registros quedan ordenados por id', async () => {
    const registros = [{ id: id(5) }, { id: id(1) }, { id: id(3) }];
    const cubos = await cubosDe(registros, 1);
    for (const [, lista] of cubos) {
      const ids = lista.map(r => r.id);
      expect(ids).toEqual([...ids].sort());
    }
  });

  it('lista vacía produce un mapa vacío', async () => {
    const cubos = await cubosDe([], 1);
    expect(cubos.size).toBe(0);
  });
});

describe('profundidadNecesaria — P3', () => {
  it('un campo que a d=1 supera SPLIT_BYTES en algún cubo sube a d=2, y ahí todos entran', async () => {
    // Todos con el MISMO primer hex ('0') fuerza que un solo cubo cargue con
    // todo el peso a d=1. El SEGUNDO hex varía con `i % 16`, así que a d=2 se
    // reparten en hasta 16 cubos parejos — cada uno bien por debajo de SPLIT.
    const relleno = 'x'.repeat(3_000);
    const registros = Array.from({ length: 100 }, (_, i) => ({
      id: `0${(i % 16).toString(16)}000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      relleno,
    }));

    const d = await profundidadNecesaria(registros, 1, SPLIT_BYTES);
    expect(d).toBeGreaterThanOrEqual(2);

    const cubos = await cubosDe(registros, d);
    for (const [, lista] of cubos) {
      expect(Buffer.byteLength(JSON.stringify(lista), 'utf8')).toBeLessThan(SPLIT_BYTES);
    }
  });

  it('nunca devuelve menos que dActual (histéresis: la profundidad no baja)', async () => {
    const registros = [{ id: id(1) }];
    const d = await profundidadNecesaria(registros, 3, SPLIT_BYTES);
    expect(d).toBeGreaterThanOrEqual(3);
  });

  it('tiene un techo de profundidad 4', async () => {
    // Un solo id: por más que "necesite" más profundidad para separar nada,
    // no puede subir de 4.
    const relleno = 'x'.repeat(SPLIT_BYTES * 2);
    const registros = [{ id: id(1), relleno }, { id: id(2), relleno }];
    const d = await profundidadNecesaria(registros, 1, SPLIT_BYTES);
    expect(d).toBeLessThanOrEqual(4);
  });
});

describe('jsonDeCubo — P4, P5, P18', () => {
  const envolver = (campo: string, registros: { id: string }[]) => ({
    version: 1 as const, featureVersion: 2, fromUserId: 'yo', timestamp: 0,
    groups: [], expenses: [], payments: [], users: [],
    [campo]: registros,
  });

  it('P18: dos armados sin cambios producen JSON idéntico byte a byte', () => {
    const registros = [{ id: id(3) }, { id: id(1) }, { id: id(2) }];
    const a = jsonDeCubo(envolver, 'expenses', registros);
    // Mismo contenido, otro ORDEN de entrada: el resultado tiene que ser
    // igual porque `jsonDeCubo` ordena por id internamente (determinismo).
    const b = jsonDeCubo(envolver, 'expenses', [...registros].reverse());
    expect(a).toBe(b);
  });

  it('el JSON no lleva timestamp variable: no cambia entre dos llamadas en instantes distintos', () => {
    const registros = [{ id: id(1) }];
    const a = jsonDeCubo(envolver, 'expenses', registros);
    const b = jsonDeCubo(envolver, 'expenses', registros);
    expect(a).toBe(b);
    expect(JSON.parse(a).timestamp).toBe(0);
  });

  it('P4/P5: sólo cambia el JSON del cubo cuyo contenido cambió (alta o edición)', async () => {
    const base = Array.from({ length: 20 }, (_, i) => ({ id: id(i), monto: 100 }));
    const cubosAntes = await cubosDe(base, 1);

    // Alta: un registro nuevo con un id que cae en un prefijo YA existente.
    const conAlta = [...base, { id: id(20), monto: 1 }];
    const cubosDespuesAlta = await cubosDe(conAlta, 1);

    let cubosQueCambiaron = 0;
    for (const prefijo of new Set([...cubosAntes.keys(), ...cubosDespuesAlta.keys()])) {
      const antes = jsonDeCubo(envolver, 'expenses', cubosAntes.get(prefijo) ?? []);
      const despues = jsonDeCubo(envolver, 'expenses', cubosDespuesAlta.get(prefijo) ?? []);
      if (antes !== despues) cubosQueCambiaron++;
    }
    expect(cubosQueCambiaron).toBe(1);

    // Edición: se modifica UN registro existente.
    const editado = base.map(r => (r.id === id(5) ? { ...r, monto: 999 } : r));
    const cubosDespuesEdicion = await cubosDe(editado, 1);
    let cambiadosPorEdicion = 0;
    for (const prefijo of new Set([...cubosAntes.keys(), ...cubosDespuesEdicion.keys()])) {
      const antes = jsonDeCubo(envolver, 'expenses', cubosAntes.get(prefijo) ?? []);
      const despues = jsonDeCubo(envolver, 'expenses', cubosDespuesEdicion.get(prefijo) ?? []);
      if (antes !== despues) cambiadosPorEdicion++;
    }
    expect(cambiadosPorEdicion).toBe(1);
  });
});
