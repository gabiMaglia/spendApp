import { mergeByIdLWW } from './lww';
import type { PersonalEntry } from '@/src/types/models';

/**
 * Merge puro de movimientos personales: LWW simple, sin tope de reloj.
 *
 * Vive en su propio módulo (T-149 · D3 verifier), igual que las otras tres
 * reglas, para que `accountLink.mergeAccounts` reutilice EXACTAMENTE esta
 * función — la fusión usaba `mergeUsersLWW` (CON tope), que descarta un
 * entrante cuyo `updatedAt` esté adelantado: un movimiento personal registrado
 * a futuro por error de reloj quedaba invisible tras fusionar. El tope de
 * reloj para `personal` es T-171, fuera de este alcance.
 * `personalStore.mergeEntries` importa esta MISMA función.
 */
export function mergePersonalPure(current: PersonalEntry[], incoming: PersonalEntry[]): PersonalEntry[] {
  return mergeByIdLWW(current, incoming);
}
