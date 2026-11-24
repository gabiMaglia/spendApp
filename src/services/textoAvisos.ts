import i18n from '@/src/i18n';
import { formatMoney } from '@/src/constants/currencies';
import { claveDeFalloDeSync } from '@/src/sync/motor/publishHealth';
import { MAX_MIEMBROS } from '@/src/sync/nucleo/topes';
import { nombreDeGrupoEnConflicto, type Notice } from './syncNotices';
import { resumirAvisos } from './resumirAvisos';

/** Texto del aviso. Sin strings sueltos: todo pasa por i18n (es/en/pt). */
export function textFor(notice: Notice): { title: string; body: string } {
  const t = i18n.t.bind(i18n);
  switch (notice.kind) {
    case 'expenses':
      return {
        title: notice.groupName,
        body: t('notifications.new_expenses', { count: notice.count }),
      };
    case 'restored':
      return {
        title: notice.groupName,
        body: t('notifications.restored', { description: notice.description }),
      };
    case 'joined':
      return {
        title: t('notifications.joined_title'),
        body: t('notifications.joined_body', { group: notice.groupName }),
      };
    case 'settled':
      return {
        title: notice.groupName,
        // El monto se formatea con SU moneda, no con la de visualización: un
        // aviso convertido diría un número que no coincide con el pago real.
        body: t('notifications.settled', {
          name: '',
          amount: formatMoney(notice.amount, notice.currency),
        }).trim(),
      };
    case 'clock_off':
      return {
        title: t('notifications.clock_off_title'),
        // Lo que se promete es exactamente lo que pasa: las FECHAS se ven mal.
        // Decir «tus datos están en riesgo» sería falso — el merge ya está
        // corregido— y este proyecto no puede permitirse prometer de más.
        body: t('notifications.clock_off_body'),
      };
    case 'sync_down':
      return {
        // El grupo va en el TÍTULO junto al hecho: «Asado» solo, como en los
        // demás, escondería lo único que importa leer de un vistazo.
        title: t('notifications.sync_down_title', { group: notice.groupName }),
        // Mismo texto que el banner del grupo, de la misma función. Dos
        // redacciones para el mismo problema se contradicen sin que nadie mire.
        body: t(claveDeFalloDeSync(notice.reason)),
      };
    case 'group_key_conflict': {
      const group = nombreDeGrupoEnConflicto(notice, t);
      return {
        title: notice.senderIds.length > 2
          ? t('sync.key_conflict.title_many', { group })
          : t('sync.key_conflict.title_two', { group }),
        body: t('sync.key_conflict.body'),
      };
    }
    case 'group_replaced':
      return {
        title: t('notifications.group_replaced_title', { group: notice.groupName }),
        body: t('notifications.group_replaced_body', { newGroup: notice.newGroupName }),
      };
    case 'group_invite_full':
      return {
        title: t('notifications.invite_full_title', { group: notice.groupName }),
        body: t('notifications.invite_full_body', { max: MAX_MIEMBROS }),
      };
    case 'join_claim_stalled':
      return {
        title: t('notifications.join_stalled_title'),
        body: t('notifications.join_stalled_body', { group: notice.groupName }),
      };
    case 'group_traspaso_recurring_blocked':
      return {
        title: t('notifications.traspaso_recurring_blocked_title', { group: notice.groupName }),
        body: t('notifications.traspaso_recurring_blocked_body'),
      };
    case 'comment':
      return {
        title: notice.groupName,
        body: t('notifications.new_comments', { count: notice.count }),
      };
  }
}

export function textoResumen(notices: Notice[]): { title: string; body: string } {
  const t = i18n.t.bind(i18n);
  const { count, groups, groupName } = resumirAvisos(notices);
  const title = t('notifications.summary_title');
  if (groups === 1) return { title, body: t('notifications.summary_body_group', { count, group: groupName }) };
  if (groups > 1) return { title, body: t('notifications.summary_body_groups', { count, groups }) };
  return { title, body: t('notifications.summary_body', { count }) };
}
