import type { SessionKind } from './relaySession';

/**
 * T-147 (enmienda del PO, aprobación 2026-09-26) · última sesión conocida del
 * relay, para poder avisar en pantalla cuando el teléfono no consigue
 * sincronizar por falta de sesión.
 *
 * El caso que motiva esto: después de 011b, el buzón exige `authenticated`.
 * Si el captcha nunca resuelve (o Auth está caído), este teléfono se queda
 * con el rol `anon` — reintenta cada `SESSION_RETRY_MS` y no pierde datos
 * (I5), pero deja de sincronizar EN SILENCIO. Sin este módulo, nadie se
 * entera hasta que compara con otro teléfono y ve que no le llegó nada.
 *
 * Vive en memoria a propósito, igual que `publishHealth`: es un diagnóstico
 * del momento (la sesión actual), no un dato del usuario que haya que
 * persistir ni migrar entre cuentas.
 */

let ultima: SessionKind | 'desconocido' = 'desconocido';

/** Lo llama `relayEngine` cada vez que `ensureRelaySession()` resuelve. */
export function setUltimaSesionConocida(kind: SessionKind): void {
  ultima = kind;
}

/**
 * ¿Hay que avisar? Sólo `'none'` — arrancar sin haber preguntado todavía
 * ('desconocido') NO es un fallo, es simplemente que el motor no corrió aún
 * (relay no configurado, o la primera vuelta no terminó).
 */
export function sinSesionDeSync(): boolean {
  return ultima === 'none';
}

/** Sólo tests. */
export function __resetSessionStatus(): void {
  ultima = 'desconocido';
}
