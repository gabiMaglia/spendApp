/**
 * La privada de este dispositivo, para firmar al escribir.
 *
 * **El módulo de identidad se carga PEREZOSAMENTE**, y con eso se paga una
 * deuda conocida: `identityStore` arrastra `groupInvite` → `expo-crypto`, que
 * es nativo. Importarlo arriba lo metería en el camino del sync desde los cinco
 * stores, y un build sin ese binario no fallaría en la pantalla de gastos:
 * fallaría en el arranque. Es el mismo patrón que `src/services/avatar.ts` y la
 * misma razón por la que `src/sync/hexBytes.ts` no importa nada.
 *
 * Vive suelto porque lo usan los dos lados de la firma al escribir: el núcleo
 * de un registro (`signOnWrite.ts`, S5) y los votos de borrado
 * (`src/services/deletionVotes.ts`, S8).
 *
 * `null` cuando no se pudo, nunca una excepción: acá arriba hay un usuario
 * guardando plata, y no se le bloquea nada por un problema de criptografía.
 */
type ModuloIdentidad = typeof import('@/src/store/identityStore');
let moduloCache: ModuloIdentidad | null | undefined;

export function privadaDelAparato(): string | null {
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
    return moduloCache.ensureIdentity().privateKey || null;
  } catch {
    // Storage cifrado que no abrió, generación de clave que falló.
    return null;
  }
}
