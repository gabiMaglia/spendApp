import { recordError } from '@/src/services/errorLog';

/**
 * **Presupuesto de reintentos para una rebanada que no se pudo aplicar**
 * (T-146, TEC-01).
 *
 * Hasta acá `drainGroup` hacía `catch { skipped++ }` y el cursor avanzaba
 * igual: una rebanada que tiraba en `applyDelta` no volvía a pedirse hasta que
 * su emisor la republicara (cambio, o renovación a 20 días). Pérdida de datos
 * sin un solo rastro.
 *
 * Lo contrario —no avanzar nunca— sería peor: una rebanada rota de forma
 * determinista trabaría el grupo para siempre, y todo lo posterior a ella
 * dejaría de entrar. De ahí el presupuesto: se vuelve a intentar hasta
 * `DRAIN_MAX_REINTENTOS` veces (una por drenaje), y después se deja atrás
 * **con una entrada en el diagnóstico por cada intento**, que es lo que el
 * PO puede exportar cuando alguien dice «me falta un gasto».
 *
 * En memoria a propósito: tras reiniciar la app se vuelve a intentar 3 veces
 * más. Un fallo transitorio (un store a medio hidratar) se recupera solo; uno
 * permanente deja tres líneas más en el log y sigue sin trabar nada.
 */

export const DRAIN_MAX_REINTENTOS = 3;

const intentos = new Map<string, number>();

const clave = (topic: string, seq: number) => `${topic}\u0000${seq}`;

export function registrarFalloDeAplicacion(topic: string, seq: number, error: unknown): number {
  const n = (intentos.get(clave(topic, seq)) ?? 0) + 1;
  intentos.set(clave(topic, seq), n);

  const mensaje = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  recordError({
    // Sólo un prefijo del topic: entero identifica el grupo ante quien lea el log.
    message: `sync.apply_failed topic=${topic.slice(0, 8)} seq=${seq} intento=${n}: ${mensaje}`,
    stack,
    fatal: false,
    screen: 'sync',
  });
  return n;
}

export function agotoReintentos(topic: string, seq: number): boolean {
  return (intentos.get(clave(topic, seq)) ?? 0) >= DRAIN_MAX_REINTENTOS;
}

/** Tests, logout, wipe. */
export function olvidarFallosDeAplicacion(): void {
  intentos.clear();
}
