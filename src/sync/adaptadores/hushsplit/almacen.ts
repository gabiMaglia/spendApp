import { createStorage } from '@/src/utils/createStorage';
import { readScoped, writeScoped, deleteScoped } from '@/src/store/userScope';

/**
 * Puerto de almacenamiento para el núcleo (ledger de rebanadas publicadas,
 * rebanadas aplicadas): `get`/`set`/`delete` por clave arbitraria, scopeado
 * por cuenta (`userScope.ts`) — el núcleo no importa `userScope` directo
 * (rompería el guard P15), así que recibe esto ya resuelto.
 *
 * Módulo hoja (T-206-A): antes vivía en `adaptadorHushSplit.ts`, pero
 * `avatarTopic.ts` también lo necesita (para el ledger de cubos de la foto
 * propia) y `adaptadorHushSplit.ts` importa `publishAvatarIfOwn` de
 * `avatarTopic.ts` — los dos importándose entre sí cerraba un ciclo. Vive
 * acá, sin importar nada de `sync/`, y los dos lo importan de acá.
 */
const storageNucleo = createStorage('sync-relay-core');

export const almacen = {
  get(k: string): string | undefined {
    return readScoped(storageNucleo, k);
  },
  set(k: string, v: string): void {
    writeScoped(storageNucleo, k, v);
  },
  delete(k: string): void {
    deleteScoped(storageNucleo, k);
  },
};
