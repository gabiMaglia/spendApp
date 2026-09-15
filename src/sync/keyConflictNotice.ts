import { useGroupStore } from '@/src/store/groupStore';
import { announceKeyConflict } from '@/src/services/notifications';
import type { KeyConflictNotice } from '@/src/services/syncNotices';
import type { DrainContactsResult } from './contactChannel';
import { ofertasDe } from './groupKeyOffers';

/**
 * El aviso de claves en disputa, armado igual desde el canal de contacto y
 * desde la invitación (T-136). Una sola función: dos armados del mismo aviso
 * terminan diciendo cosas distintas.
 *
 * `null` si no hay dos remitentes: un conflicto de uno solo no tiene nada que
 * elegir.
 */
export function noticeDeConflicto(groupId: string, nombreDelDrop: string | undefined): KeyConflictNotice | null {
  const senderIds = [...new Set(ofertasDe(groupId).map(o => o.fromUserId))];
  if (senderIds.length < 2) return null;

  const local = useGroupStore.getState().getById(groupId);
  const nombreLocal = local && !local.isDeleted ? local.name : undefined;

  return {
    kind: 'group_key_conflict',
    groupId,
    groupName: nombreLocal ?? nombreDelDrop ?? '',
    senderIds,
  };
}

export async function avisarConflictoDeClave(groupId: string, nombreDelDrop: string | undefined): Promise<number> {
  const notice = noticeDeConflicto(groupId, nombreDelDrop);
  return notice ? announceKeyConflict(notice) : 0;
}

/** Lo que `drainContactsNow` hace con los grupos en conflicto de un drenaje. */
export async function avisarConflictosDelDrenaje(
  r: Pick<DrainContactsResult, 'conflictedGroups' | 'nombresDeDrop'>,
): Promise<number> {
  let avisados = 0;
  for (const groupId of r.conflictedGroups) {
    // Los ids vienen de afuera: sin `hasOwnProperty`, 'constructor' devolvería
    // una función del prototipo como nombre del grupo.
    const nombre = Object.prototype.hasOwnProperty.call(r.nombresDeDrop, groupId)
      ? r.nombresDeDrop[groupId]
      : undefined;
    try {
      avisados += await avisarConflictoDeClave(groupId, nombre);
    } catch { /* un aviso que falla no frena a los demás ni al sync */ }
  }
  return avisados;
}
