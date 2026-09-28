/**
 * La prenda de escritura de este dispositivo, para el buzón (ADR-009, T-088).
 *
 * **El módulo de identidad se carga PEREZOSAMENTE**, y es la misma deuda que
 * paga `devicePrivateKey.ts` por el mismo motivo: `identityStore` arrastra
 * `groupInvite` → `expo-crypto`, que es nativo. `relay.ts` hoy no importa nada
 * nativo, y meterlo arriba haría que un build sin ese binario no fallara al
 * publicar: fallaría en el arranque.
 *
 * `null` cuando no se pudo, nunca una excepción: publicar un sobre no se
 * bloquea porque la prenda no esté. Un sobre sin prenda se comporta como los de
 * antes de T-088 — se compacta por `sender` y sólo lo levanta el TTL.
 */
type ModuloIdentidad = typeof import('@/src/store/identityStore');
let moduloCache: ModuloIdentidad | null | undefined;

export function prendaDelAparato(): { secret: string; proof: string } | null {
  if (moduloCache === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      moduloCache = require('@/src/store/identityStore') as ModuloIdentidad;
    } catch {
      moduloCache = null;
    }
  }
  if (!moduloCache) return null;

  try {
    const p = moduloCache.ensureOwnerPledge();
    return p.secret && p.proof ? p : null;
  } catch {
    // Storage cifrado que no abrió, generación que falló.
    return null;
  }
}

/** Sólo para tests: el caché del módulo es de archivo y sobrevive entre casos. */
export function olvidarPrendaEnCache(): void {
  moduloCache = undefined;
}
