/**
 * Puertos — lo que el núcleo/motor pide y la app provee (T-206-A Task 2,
 * spec 2026-09-28-sync-extraible-design.md §2.1, con la firma de
 * `Identidad.firmar` y `Puerto Documento` según §7.6 filas 8 y 10, y el
 * ajuste del encabezado del plan: `Transporte.publicar` sin `ownerTag` —
 * la prenda de ADR-009 queda adentro del adaptador de Supabase).
 *
 * Sólo TIPOS. Nadie los implementa todavía salvo `Almacen`, que ya
 * describía dos veces el mismo contrato (`nucleo/sliceLedger.ts` y
 * `nucleo/appliedSlices.ts`, D6) — acá queda uno solo y los dos módulos lo
 * importan. El resto (`Transporte`, `Identidad`, `ClavesDeGrupo`,
 * `Documento`, `Reloj`, `Log`, `Avisos`) documenta la forma que va a tener
 * la inyección en la etapa B (spec §6): hoy el motor sigue leyendo stores
 * directo (deuda declarada V1/V2/V7/V9/V10, ver `relayFrontera.guard.test.ts`).
 *
 * Un puerto nuevo, o un cambio de firma acá, es superficie pública del
 * paquete futuro — requiere ADR (spec §5.1 "Versionado y compatibilidad").
 */

/** Clave/valor síncrono, YA scopeado por cuenta. Hoy: `adaptador.almacen` (MMKV). */
export interface Almacen {
  get(k: string): string | undefined;
  set(k: string, v: string): void;
  delete(k: string): void;
}

/** Un sobre tal como lo entrega el transporte al leer. */
export type Sobre = { seq: number; payload: string; sender: string; ckey?: string };

/** El buzón tonto: publica, lee desde un cursor, borra lo propio, avisa. */
export interface Transporte {
  publicar(
    topic: string,
    payload: string,
    o: { ckey?: string; compactable: boolean; signal?: AbortSignal },
  ): Promise<
    | { ok: true; seq: number }
    | { ok: false; reason: 'not_configured' | 'too_large' | 'network' | 'rate_limited'; detail?: string }
  >;
  leerDesde(
    topic: string,
    cursor: number,
    o?: { excluirEmisor?: string; limite?: number },
  ): Promise<
    | { ok: true; sobres: Sobre[]; cursor: number; hayMas?: boolean }
    | { ok: false; reason: 'not_configured' | 'network'; detail?: string }
  >;
  borrarMios(topic: string): Promise<{ ok: true; borrados: number } | { ok: false; reason: string; detail?: string }>;
  suscribir(topic: string, alAviso: () => void, alEstado?: (sano: boolean) => void): () => void;
  readonly maxPayloadBytes: number;
}

/** Clave de un grupo, en la época vigente. */
export type ClavesDeGrupo = { clave: Uint8Array; epoch: number };

/**
 * Identidad del aparato y acceso a claves de grupo. `firmar` devuelve la
 * firma, nunca la privada — el motor no necesita TENER la clave (spec §7.6
 * fila 8): así la app puede firmar desde el llavero del sistema el día de
 * mañana sin tocar este puerto.
 */
export interface Identidad {
  emisor(): string;
  firmar(sellado: string): string;
  claveDelGrupo(grupoId: string): ClavesDeGrupo | null;
  sesion(): string | null;
  verificarEmisor?(grupoId: string, autor: string, clavePublica: string): Promise<'ok' | 'descartar'>;
}

/**
 * Lo que la app sincroniza. Versión del orquestador (spec §7.6 fila 10,
 * concedida para la etapa B): `aplicar(grupo, campo, registros)` en vez de
 * `envolver`+`acotar`+`aplicar(delta)` separados — coincide 1:1 con
 * `adaptadorHushSplit.ts` de hoy y achica el cambio cuando se inyecte.
 */
export interface Documento {
  /** En orden de DEPENDENCIA: lo que otro campo referencia va antes. */
  campos: readonly string[];
  armar(grupoId: string, ctx: { emisor: string }): Promise<Record<string, { id: string }[]>>;
  aplicar(grupoId: string, campo: string, registros: unknown[]): Promise<{ porTope: number; porDependencia: number }>;
  /** Tope por registro individual; por defecto el motor sólo mide bytes. */
  excede?(registro: unknown): string | null;
  codec?: {
    envolver(campo: string, regs: { id: string }[]): unknown;
    desenvolver(x: unknown): { campo: string; registros: unknown[] }[];
  };
}

/** SHA-256 y bytes aleatorios — lo único nativo que le queda al núcleo (spec §2.1, V5). */
export interface Cripto {
  sha256Hex(s: string): Promise<string>;
  aleatorio(n: number): Uint8Array;
}

/** Reloj del motor: instante actual, ceder el hilo, reengancharse a primer plano. */
export interface Reloj {
  ahora(): number;
  ceder(): Promise<void>;
  alVolverAPrimerPlano?(fn: () => void): () => void;
}

/** Salida de error, sin decidir cómo se muestra. */
export interface Log {
  error(mensaje: string, e?: unknown): void;
}

/** Diagnóstico de salida del motor — no avisa a la persona, informa a la app. */
export interface Avisos {
  publicacion?(grupoId: string, r: unknown): void;
  manifiesto?(grupoId: string, ckeysFaltantes: string[]): void;
  aplicado?(grupoId: string, n: number): void;
}

// ---------------------------------------------------------------------
// D18: tipos de drenar.ts, antes en nucleo/drenarTypes.ts — existía sólo
// para que drenar.ts quedara bajo 260 líneas; acá tienen un hogar con
// sentido propio (son la forma del resultado de UN drenaje).
// ---------------------------------------------------------------------

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
