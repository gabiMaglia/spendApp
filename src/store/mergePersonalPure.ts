import { mergeByIdLWW } from './lww';
import type { PersonalEntry } from '@/src/types/models';

/**
 * Merge puro de movimientos personales: LWW con tope de reloj (T-171).
 *
 * Vive en su propio módulo (T-149 · D3 verifier), igual que las otras tres
 * reglas, para que `accountLink.mergeAccounts` reutilice EXACTAMENTE esta
 * función (la misma que usa `personalStore.mergeEntries` para sync/backup).
 *
 * Hasta T-171, `mergeByIdLWW` no tenía tope: un `updatedAt: 9e15` ganaba para
 * siempre porque ninguna edición honesta futura podía superarlo numéricamente
 * (`engram/qa/T-144-verifier.md`). Ahora `mergeByIdLWW` aplica el mismo tope
 * que `mergeUsersLWW` — un `updatedAt` dentro de `TOLERANCIA_RELOJ_MS` sigue
 * ganando normal (cubre el error de reloj chico que motivó la nota vieja de
 * este docblock); sólo lo absurdamente futuro o no numérico pierde.
 */
export function mergePersonalPure(current: PersonalEntry[], incoming: PersonalEntry[], now: number): PersonalEntry[] {
  return mergeByIdLWW(current, incoming, now);
}
