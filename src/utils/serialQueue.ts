/**
 * FIFO genérico para operaciones que no pueden pisarse (T-147, SIMPLIFICACIÓN
 * 2026-09-27) — extraído de `relaySession.encolarOperacionDeSesion`.
 *
 * Cada `createSerialQueue()` es independiente: `relaySession.ts` abre la suya
 * para serializar lecturas/escrituras de la sesión ANÓNIMA del buzón, y
 * `directoryAuth.ts` abre otra para el login/logout del directorio de claves.
 * Antes compartían una sola cola porque los dos leían y escribían el MISMO
 * cliente de Supabase; con clientes separados (buzón vs directorio, cada uno
 * con su propio storage) esa carrera ya no existe entre ellos — pero SIGUE
 * existiendo dentro de cada uno (un logout lento del directorio no puede
 * terminar después de que el login siguiente ya escribió su sesión).
 */
export type SerialQueue = {
  /** Encola `fn`: corre recién cuando todo lo encolado antes terminó. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** Cuántas operaciones siguen en vuelo (encoladas o corriendo). */
  pendientes(): number;
};

export function createSerialQueue(): SerialQueue {
  let cadena: Promise<unknown> = Promise.resolve();
  let enVuelo = 0;

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      enVuelo++;
      const siguiente = cadena.then(fn, fn);
      // Un rechazo no puede frenar la cadena compartida: la PRÓXIMA operación
      // encolada tiene que poder correr igual.
      cadena = siguiente.catch(() => undefined);
      void siguiente.finally(() => { enVuelo--; }).catch(() => undefined);
      return siguiente;
    },
    pendientes(): number {
      return enVuelo;
    },
  };
}
