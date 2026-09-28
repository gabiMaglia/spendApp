import * as Crypto from 'expo-crypto';
import { RE_UUID } from '@/src/utils/linkCompacto';

/**
 * Cubos por prefijo de id (T-191, spec §2.1) — núcleo puro, sin stores ni
 * tipos de HushSplit (frontera P15, `relayFrontera.guard.test.ts`).
 *
 * Reemplaza el corte por ÍNDICE de rebanada de `slices.ts#sliceEntities`: un
 * registro va SIEMPRE al mismo cubo (por su id), así que un alta o una
 * edición sólo tocan el/los cubo(s) donde caen sus ids — nunca corre el corte
 * de los demás, que es justo lo que `sliceEntities` no podía garantizar
 * (T-146 ya arregló la mitad del problema con la ckey por índice; esto
 * arregla la otra mitad: qué registro cae en qué rebanada).
 */

/**
 * Objetivo de tamaño por cubo (spec §8, C3 — decisión del PO, opción B):
 * 192 KB. Con esto un campo se queda en 16 cubos (d=1) hasta ~6.000 gastos;
 * subir a d=2 (256 cubos) recién hace falta para grupos mucho más grandes.
 * El tope duro sigue siendo `MAX_SLICE_BYTES` de `slices.ts` (256 KB) — un
 * cubo que lo supera a profundidad máxima se publica igual y `sendEnvelope`
 * lo rechaza, como ya pasa hoy con un registro individual gigante.
 */
export const SPLIT_BYTES = 196_608;

/** Profundidad máxima de prefijo: 4 hex = 65.536 cubos posibles por campo. */
export const MAX_PROFUNDIDAD = 4;

function byteLength(s: string): number {
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

async function sha256Hex(s: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s);
}

/**
 * A qué cubo (prefijo hex de `d` dígitos) pertenece un id.
 *
 * Un UUID (formato canónico, sin importar mayúsculas/minúsculas — se
 * normaliza a minúsculas antes de chequear) usa sus PROPIOS dígitos hex,
 * sin guiones: es alta entropía por construcción, así que no hace falta
 * hashear, y usar el id tal cual hace que el cubo de un registro sea
 * verificable a simple vista. Un id que no tiene forma de UUID (P2 — hoy no
 * pasa en HushSplit, pero el núcleo no puede asumirlo) usa el prefijo de
 * `sha256(id)`, para no crear cubos sesgados por un id corto o secuencial.
 */
export async function prefijoDe(id: string, d: number): Promise<string> {
  const minuscula = id.toLowerCase();
  const hex = RE_UUID.test(minuscula) ? minuscula.replace(/-/g, '') : await sha256Hex(id);
  return hex.slice(0, d);
}

/**
 * Reparte `registros` en cubos por `prefijoDe(id, d)`. Cada cubo queda
 * ordenado por id — determinismo (spec §7 C1): dos armados sucesivos sin
 * cambios de contenido producen la MISMA lista en el MISMO orden, y por lo
 * tanto (vía `jsonDeCubo`) el mismo JSON.
 */
export async function cubosDe<T extends { id: string }>(
  registros: readonly T[],
  d: number,
): Promise<Map<string, T[]>> {
  const cubos = new Map<string, T[]>();
  for (const r of registros) {
    const prefijo = await prefijoDe(r.id, d);
    const lista = cubos.get(prefijo);
    if (lista) lista.push(r);
    else cubos.set(prefijo, [r]);
  }
  for (const lista of cubos.values()) lista.sort((a, b) => a.id.localeCompare(b.id));
  return cubos;
}

/**
 * La menor profundidad `d ≥ dActual` tal que ningún cubo de `registros`
 * supera `splitBytes` (medido en JSON, UTF-8 real) — o `MAX_PROFUNDIDAD` si
 * ni ahí alcanza (spec §2.1: "se registra y no se diseña para eso").
 *
 * Nunca devuelve menos que `dActual`: la histéresis (spec §7 C3, "la
 * profundidad no baja") vive del lado del llamador, que guarda la máxima
 * alcanzada en el ledger (`sliceLedger`, Task 2) y la pasa acá como
 * `dActual` en cada publicación — esta función sólo decide si TODAVÍA
 * alcanza o hay que subir.
 */
export async function profundidadNecesaria<T extends { id: string }>(
  registros: readonly T[],
  dActual: number,
  splitBytes: number,
): Promise<number> {
  let d = Math.max(1, dActual);
  while (d < MAX_PROFUNDIDAD) {
    const cubos = await cubosDe(registros, d);
    let excede = false;
    for (const lista of cubos.values()) {
      if (byteLength(JSON.stringify(lista)) > splitBytes) { excede = true; break; }
    }
    if (!excede) break;
    d++;
  }
  return d;
}

/**
 * JSON determinista de UN cubo, ya envuelto como el sobre que se va a sellar
 * (spec §7 C1): `envolver` es la función del adaptador que arma el
 * `SyncDelta` de esa porción — este módulo no sabe qué forma tiene, sólo que
 * es serializable. Los registros se ordenan por id ANTES de envolver, así
 * que el orden de entrada no afecta el resultado — dos publicaciones
 * sucesivas sin cambios de contenido dan el MISMO string, byte a byte, y por
 * lo tanto el mismo digest (`sliceLedger` no reenvía nada, Task 2).
 */
export function jsonDeCubo<T extends { id: string }>(
  envolver: (campo: string, registros: T[]) => unknown,
  campo: string,
  registros: readonly T[],
): string {
  const ordenados = [...registros].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(envolver(campo, ordenados));
}
