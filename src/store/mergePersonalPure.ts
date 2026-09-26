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
 *
 * **PO 2026-09-26 (fix ronda 1) — «agregar, pero no pisar».** El tope a
 * secas (igual que `users`) descartaba un movimiento personal NUEVO con
 * reloj adelantado (T-149 D3, `fusionUsaMergeDelStore.test.ts`) — y en
 * `personal` eso es casi siempre el reloj del PROPIO dueño, no un atacante:
 * acá el único que escribe es el dueño del dispositivo (a diferencia de
 * `users`, donde cualquier co-miembro puede mandarte un perfil por el
 * relay). Perder un movimiento propio es peor que dejarlo un rato con un
 * `updatedAt` envenenado. Por eso acá se pasa
 * `agregarNuevosEnvenenados: true`: un entrante envenenado con id NUEVO se
 * agrega igual; uno con id YA EXISTENTE sigue sin poder pisar al local (ahí
 * no hay forma de distinguir "mi reloj se adelantó" de "me llegó basura",
 * así que se mantiene el criterio conservador). `users` (`mergeUsersLWW.ts`)
 * deja la opción en su default (`false`) a propósito: no debe cambiar.
 */
export function mergePersonalPure(current: PersonalEntry[], incoming: PersonalEntry[], now: number): PersonalEntry[] {
  return mergeByIdLWW(current, incoming, now, { agregarNuevosEnvenenados: true });
}
