import * as Crypto from 'expo-crypto';
import type { GroupKey } from './envelopeCrypto';
import { toHex } from './envelopeCrypto';

/**
 * Mide bytes UTF-8 reales, no unidades UTF-16 de `.length` (revisión final,
 * Fix 6: `.length` subestima acentos/emoji).
 *
 * Deliberadamente DUPLICADA de `relay.ts`'s `byteLength` (mismo algoritmo,
 * byte a byte) en vez de importada desde ahí: `slices.ts` es un módulo puro
 * a propósito (Task 2 del plan — sólo depende de `envelopeCrypto`), mientras
 * que `relay.ts` es la capa de transporte/red, mockeada por nombre en casi
 * todos los tests de `sync/__tests__` para no hablar con Supabase de
 * verdad. Importar `relay.ts` acá acoplaría un módulo puro a esos mocks —
 * cualquier test que mockee `../relay` sin re-exportar `byteLength`
 * rompería el slicing por una razón que no tiene nada que ver con lo que ese
 * test intenta probar. Diez líneas duplicadas salen más baratas que esa
 * fragilidad.
 */
function byteLength(s: string): number {
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

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
 *
 * El tamaño se mide en bytes UTF-8 reales (`byteLength`, `relay.ts`), no en
 * `.length` de JS (unidades UTF-16) — revisión final, hallazgo menor: contar
 * `.length` subestima el peso real de cualquier texto con acentos o emoji,
 * y es justamente lo que `relay.ts` usa para el tope real del sobre
 * (`MAX_PAYLOAD_BYTES`). Medir distinto acá que en el chequeo real desalinea
 * la contabilidad de rebanadas del límite que en verdad importa.
 */
export function sliceEntities<T extends { id: string }>(entities: T[]): T[][] {
  if (entities.length === 0) return [];

  const ordenadas = [...entities].sort((a, b) => a.id.localeCompare(b.id));
  const rebanadas: T[][] = [];
  let actual: T[] = [];
  let tamanoActual = 2; // '[' + ']'

  for (const item of ordenadas) {
    const itemJson = JSON.stringify(item);
    const bytesItem = byteLength(itemJson);

    // Aviso, no corte (revisión final, hallazgo menor): un elemento solo que
    // ya supera el tope duro se manda igual, entero, en su propia rebanada —
    // partirlo a la mitad lo rompería. Lo único que faltaba era el aviso que
    // el plan siempre prometió ("enviado entero y señalado").
    if (bytesItem > MAX_SLICE_BYTES) {
      console.warn(
        `sliceEntities: el elemento "${item.id}" pesa ${bytesItem} bytes, ` +
        `supera MAX_SLICE_BYTES (${MAX_SLICE_BYTES}) — se envía igual, entero, en su propia rebanada.`,
      );
    }

    const tamanoItem = bytesItem + 1; // + coma/cierre
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
