import * as Crypto from 'expo-crypto';
import type { GroupKey } from './envelopeCrypto';
import { toHex } from './envelopeCrypto';

/**
 * `ckey` es opaca para el servidor — se deriva de la clave del grupo más el
 * tipo de entidad y el PREFIJO del cubo dentro de ese tipo (T-191, `cubos.ts`;
 * antes, T-146, era el ÍNDICE de la rebanada, y antes de T-146 el primer id
 * de la rebanada, donde cada inserción que ordenaba antes re-claveaba todas
 * las siguientes). El prefijo es ESTABLE — no depende de cuántos cubos haya
 * ni del orden de inserción — así que un cubo que no cambió mantiene la misma
 * `ckey` entre publicaciones y no se reenvía. Lo único que el relay puede
 * contar es cuántos cubos hay, que ya podía contar antes.
 * Mismo mecanismo que `deriveTopic` (SHA256 de la clave en hex + contexto),
 * no HMAC formal: la clave del grupo ya es un secreto de 32 bytes de alta
 * entropía, así que nadie sin la clave puede reproducir el hash.
 */
export async function deriveCkey(key: GroupKey, tipo: string, prefijo: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${toHex(key)}:ckey:${tipo}:${prefijo}`,
  );
}
