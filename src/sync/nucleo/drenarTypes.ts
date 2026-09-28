/** Tipos de `drenar.ts` — aparte para que el archivo con la lógica quede bajo 260 líneas. */
export type DrainResult =
  | {
      ok: true; applied: number; skipped: number; cursor: number;
      /**
       * `true` = el buzón se leyó hasta el final (última página corta). `false`
       * = quedó algo por delante del cursor: una página más, o una rebanada que
       * falló y se va a volver a pedir. Sólo con `true` se puede limpiar la
       * marca de «pendiente de drenaje» (T-089); con `false` el grupo espera a
       * la próxima vuelta. Nada se pierde: se posterga.
       */
      completo: boolean;
    }
  | { ok: false; reason: 'no_key' | 'not_configured' | 'network' | 'key_changed'; detail?: string };

/** Sólo tests: páginas chicas para ejercitar la paginación sin 200 sobres. */
export type DrainOptions = {
  pageLimit?: number;
  maxPages?: number;
  /**
   * T-158b: se invoca UNA sola vez, justo antes de aplicar la primera página
   * que trae rebanadas de datos — nunca si el buzón está vacío. Existe para
   * que `drainNow` tome su "foto previa" (`snapshot`, T-010) perezosamente.
   */
  antesDeAplicar?: () => void;
};
