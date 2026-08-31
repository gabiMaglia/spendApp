import type { PersonalEntry, PersonalEntryKind } from '@/src/types/models';

/**
 * De dónde viene un movimiento personal (ADR-006, decisión 4).
 *
 * - `manual`: lo cargó la persona. **Editable.**
 * - `derived`: es el efecto de otra cosa —la réplica de un gasto de grupo, un
 *   saldo registrado, el arrastre de un mes—. **No editable.**
 *
 * Editar un derivado lo desincronizaría de su origen sin forma de
 * reconciliarlos: quedaría un movimiento diciendo una cosa y un gasto de grupo
 * diciendo otra, sin nadie que pueda decidir cuál vale. Se corrige el origen y
 * el derivado sigue.
 */
export type EntryOrigin = 'manual' | 'derived';

/**
 * Las clases que NO nacen de una acción directa sobre el movimiento.
 *
 * Se enumeran las derivadas y no las manuales a propósito: si mañana aparece
 * una clase nueva, el default la trata como MANUAL y a lo sumo se puede editar
 * algo que quizá no debería. Al revés —tratar lo desconocido como derivado—
 * dejaría al usuario sin poder tocar un movimiento suyo, sin ninguna pista de
 * por qué.
 */
const DERIVADAS: readonly PersonalEntryKind[] = ['group_replicated', 'carryover'];

export function originOf(entry: Pick<PersonalEntry, 'kind'>): EntryOrigin {
  return DERIVADAS.includes(entry.kind) ? 'derived' : 'manual';
}

/** ¿Se puede editar este movimiento? */
export function isEditable(entry: Pick<PersonalEntry, 'kind'>): boolean {
  return originOf(entry) === 'manual';
}

/**
 * Por qué no se puede editar. La pantalla lo usa para decirlo en vez de
 * simplemente no responder al toque, que se lee como que la app está rota.
 */
export function reasonKey(entry: Pick<PersonalEntry, 'kind'>): string | null {
  if (isEditable(entry)) return null;
  return entry.kind === 'group_replicated'
    ? 'personal.locked_from_group'
    : 'personal.locked_derived';
}
