import * as Crypto from 'expo-crypto';
import type { GroupKey } from './envelopeCrypto';
import { toHex } from './envelopeCrypto';

/**
 * Objetivo de tamaño por rebanada (JSON, antes de sellar/firmar) y tope duro.
 * El presupuesto real hoy es ~786.000 bytes de JSON (MAX_PAYLOAD_BYTES = 1 MB
 * en relay.ts, menos el ×4/3 del base64 y el esqueleto del sobre firmado).
 * 64 KB de objetivo y 256 KB de tope dejan margen de sobra para crecer entre
 * ciclos de renovación sin acercarse al acantilado.
 */
export const TARGET_SLICE_BYTES = 65_536;
export const MAX_SLICE_BYTES = 262_144;

/**
 * `ckey` es opaca para el servidor — se deriva de la clave del grupo, nunca
 * del id de un registro (eso le daría al relay un conteo de registros).
 * Mismo mecanismo que `deriveTopic` (SHA256 de la clave en hex + contexto),
 * no HMAC formal: la clave del grupo ya es un secreto de 32 bytes de alta
 * entropía, de un solo uso por grupo, así que la propiedad que hace falta
 * (nadie sin la clave puede reproducir el hash) ya está cubierta.
 */
export async function deriveCkey(key: GroupKey, tipo: string, seedId: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${toHex(key)}:ckey:${tipo}:${seedId}`,
  );
}

/**
 * Parte una lista de entidades en rebanadas, cada una intentando quedar bajo
 * `TARGET_SLICE_BYTES` de JSON. Greedy: acumula en orden hasta que agregar el
 * siguiente elemento cruzaría el objetivo, ahí cierra la rebanada y empieza
 * otra. Un elemento solo que ya supera el objetivo queda solo en su propia
 * rebanada — nunca se descarta ni se trunca (ver `MAX_SLICE_BYTES` como aviso,
 * no como corte: cortar a la mitad un registro lo rompería).
 *
 * Partición puramente LOCAL: cada dispositivo decide la suya sin coordinarse
 * con otros (ADR-007 §3.1) — por eso el orden de entrada (por `id`) es lo
 * único que importa para que la partición sea estable entre publicaciones
 * sucesivas del MISMO dispositivo, no para que coincida con la de otro.
 */
export function sliceEntities<T extends { id: string }>(entities: T[]): T[][] {
  if (entities.length === 0) return [];

  const ordenadas = [...entities].sort((a, b) => a.id.localeCompare(b.id));
  const rebanadas: T[][] = [];
  let actual: T[] = [];
  let tamanoActual = 2; // '[' + ']'

  for (const item of ordenadas) {
    const tamanoItem = JSON.stringify(item).length + 1; // + coma/cierre
    if (actual.length > 0 && tamanoActual + tamanoItem > TARGET_SLICE_BYTES) {
      rebanadas.push(actual);
      actual = [];
      tamanoActual = 2;
    }
    actual.push(item);
    tamanoActual += tamanoItem;
  }
  if (actual.length > 0) rebanadas.push(actual);

  return rebanadas;
}
