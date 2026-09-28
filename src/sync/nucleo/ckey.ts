import * as Crypto from 'expo-crypto';
import type { GroupKey } from './envelopeCrypto';
import { toHex } from './envelopeCrypto';
import { MAX_REGISTRO_BYTES } from './limites';

/**
 * Tope duro por rebanada (JSON, antes de sellar/firmar). El presupuesto real
 * hoy es ~786.000 bytes de JSON (MAX_PAYLOAD_BYTES = 1 MB en relay.ts, menos
 * el ×4/3 del base64 y el esqueleto del sobre firmado): 256 KB deja margen de
 * sobra. El objetivo por cubo (192 KB) vive en `cubos.ts` (T-191).
 * T-206-A (D8): la constante en sí vive en `limites.ts`, junto con
 * `MAX_REGISTRO_BYTES` (mismo valor, `topes.ts`) — de ahí las dos.
 */
export const MAX_SLICE_BYTES = MAX_REGISTRO_BYTES;

/**
 * `ckey` es opaca para el servidor — se deriva de la clave del grupo más el
 * tipo de entidad y el ÍNDICE de la rebanada dentro de ese tipo (T-146; antes
 * era el primer id de la rebanada, y cada inserción que ordenaba antes
 * re-claveaba todas las siguientes). Lo único que el relay puede contar es
 * cuántas rebanadas hay, que ya podía contar antes.
 * Mismo mecanismo que `deriveTopic` (SHA256 de la clave en hex + contexto),
 * no HMAC formal: la clave del grupo ya es un secreto de 32 bytes de alta
 * entropía, así que nadie sin la clave puede reproducir el hash.
 */
export async function deriveCkey(key: GroupKey, tipo: string, indice: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${toHex(key)}:ckey:${tipo}:${indice}`,
  );
}
