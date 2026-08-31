import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from '@/src/store/userScope';

/**
 * **Caché de públicas ya resueltas por autor** (T-041 · S3).
 *
 * Es la fuente 3 del §2 del plan: las claves con las que ya sabemos que hay que
 * verificar los registros de una persona. Las otras dos fuentes —el registro
 * local de peers (`contactChannel.getPeer`) y el directorio por cuenta
 * (`fetchAccountKeys`)— se consultan como UNIÓN con ésta, y ese trabajo es S4.
 *
 * **Por qué existe una caché y no se consulta directo:** el único lugar donde
 * hace falta el veredicto es el merge, y `applyDelta` es síncrono (§3). Una
 * consulta de red adentro del merge no es una opción. Así que acá la API es
 * síncrona y sin red, y el refresco pasa fuera de banda al drenar (S4).
 *
 * **No es un acumulador TOFU, y es deliberado.** Sería cómodo guardar la clave
 * de cualquier registro que verifique contra sí mismo, pero eso deja que el
 * PRIMER registro de un autor desconocido —que puede ser el del atacante— siembre
 * su propia clave y a partir de ahí todo lo que él firme dé `valida`. Acá sólo
 * entra lo que otra fuente ya resolvió. Un autor sin claves resueltas produce
 * `no_verificable`, que por decisión del PO (R1) nunca es un rechazo.
 *
 * Va scopeada por cuenta: son afirmaciones sobre los pares de ESA cuenta.
 */

const storage = createSecureStorage('users');

export const AUTHOR_KEYS_CACHE_KEY = 'author_keys_v1';

/**
 * La clave es del APARATO y no se scopea por cuenta (`identityStore.ts:7-10`),
 * así que una persona con dos teléfonos tiene dos. El techo está para que una
 * cuenta que reinstala muchas veces no haga crecer esto sin fin; se descartan
 * las más viejas, y si hace falta una descartada vuelve por S4.
 */
export const AUTHOR_KEYS_MAX_PER_AUTHOR = 8;

const ES_PUBLICA = /^[0-9a-f]{64}$/i;

let porAutor = new Map<string, string[]>();
let cargado = false;

function cargar(): void {
  if (cargado) return;
  cargado = true;

  const raw = readScoped(storage, AUTHOR_KEYS_CACHE_KEY);
  if (!raw) return;

  try {
    const d: unknown = JSON.parse(raw);
    if (!d || typeof d !== 'object' || Array.isArray(d)) return;

    for (const [autor, valor] of Object.entries(d as Record<string, unknown>)) {
      if (!autor || !Array.isArray(valor)) continue;

      // Se filtra clave por clave: una entrada podrida se lleva sólo lo suyo.
      // Quedarse con MENOS claves degrada a `no_verificable`; quedarse con una
      // de más sería aceptar una firma ajena como buena.
      const limpias = valor.filter(
        (k): k is string => typeof k === 'string' && ES_PUBLICA.test(k),
      );
      if (limpias.length > 0) porAutor.set(autor, limpias.slice(0, AUTHOR_KEYS_MAX_PER_AUTHOR));
    }
  } catch {
    porAutor = new Map();
  }
}

function guardar(): void {
  writeScoped(
    storage, AUTHOR_KEYS_CACHE_KEY,
    JSON.stringify(Object.fromEntries(porAutor.entries())),
  );
}

/** Las públicas que sabemos de este autor. Síncrona, sin red, sin excepciones. */
export function knownAuthorKeys(authorId: string): readonly string[] {
  if (!authorId) return [];
  cargar();
  return porAutor.get(authorId) ?? [];
}

/**
 * Anota una pública como resuelta para un autor.
 *
 * Sólo debería llamarlo quien ya ató la clave a la persona por otra vía (el QR
 * de contacto o el directorio por cuenta). Una clave con formato equivocado se
 * descarta en silencio: guardarla no serviría para verificar nada y ensuciaría
 * la caché.
 */
export function rememberAuthorKey(authorId: string, publicKey: string): void {
  if (!authorId || !ES_PUBLICA.test(publicKey)) return;
  cargar();

  const actuales = porAutor.get(authorId) ?? [];
  if (actuales.includes(publicKey)) return;

  porAutor.set(authorId, [...actuales, publicKey].slice(-AUTHOR_KEYS_MAX_PER_AUTHOR));
  guardar();
}

/** Vacía memoria y disco. Logout, wipe, tests. */
export function forgetAuthorKeys(): void {
  porAutor = new Map();
  cargado = true;
  writeScoped(storage, AUTHOR_KEYS_CACHE_KEY, '');
}

/** Suelta lo que hay en memoria y vuelve a leer de disco. Cambio de cuenta y tests. */
export function reloadAuthorKeys(): void {
  porAutor = new Map();
  cargado = false;
}
