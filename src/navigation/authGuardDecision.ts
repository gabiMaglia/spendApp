import type { EntryGateEstado } from '@/src/store/entryGateStore';

/**
 * T-147 (fila 9, decisión del PO 2026-09-27, `engram/plans/T-147.md`): la
 * app NO pasa a las tabs hasta que hay sesión del buzón o la persona elige
 * seguir sin verificar.
 *
 * Pura a propósito (sin React ni `expo-router`): es la única función que
 * decide a dónde navega `AuthGuard`, así que la tabla completa de estados se
 * puede probar sin montar la app.
 */

export type AuthGuardAccion = 'ninguna' | 'ir_a_auth' | 'ir_a_verify' | 'ir_a_tabs';

export interface AuthGuardDecisionInput {
  isLoading: boolean;
  hayUsuario: boolean;
  inAuth: boolean;
  gate: EntryGateEstado;
}

export function decidirNavegacionAuthGuard(
  { isLoading, hayUsuario, inAuth, gate }: AuthGuardDecisionInput,
): { accion: AuthGuardAccion } {
  if (isLoading) return { accion: 'ninguna' };

  if (!hayUsuario) {
    return { accion: inAuth ? 'ninguna' : 'ir_a_auth' };
  }

  if (!inAuth) return { accion: 'ninguna' };

  // Hay usuario y está en /auth: acá decide el gate de la fila 9.
  if (gate === 'chequeando') return { accion: 'ninguna' }; // sin flash de ninguna pantalla
  if (gate === 'pendiente') return { accion: 'ir_a_verify' };
  return { accion: 'ir_a_tabs' }; // 'ninguna' (nunca se pidió) o 'lista' (ya resuelta/omitida)
}
