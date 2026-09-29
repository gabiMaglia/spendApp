import React from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { BottomSheet, SheetOption } from '@/src/components/Sheet';
import { useGroupStore } from '@/src/store/groupStore';
import { esYo } from '@/src/store/identityAlias';
import type { Group, User } from '@/src/types/models';

/**
 * Hoja del «…» del detalle: invitar (a quien es miembro) y borrar el grupo
 * (creador) o salir (el resto). T-223: salió de `app/groups/[id].tsx`.
 */
export function MenuDeGrupo({
  visible, onClose, group, currentUser, onAddPerson, onShareInvite, onLeave,
}: {
  visible: boolean;
  onClose: () => void;
  group: Group;
  currentUser: User | null;
  onAddPerson: () => void;
  onShareInvite: () => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const deleteGroup = useGroupStore(st => st.deleteGroup);

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {group && currentUser && group.memberIds.some(esYo) && (
        <>
          <SheetOption
            icon="person-add-outline"
            label={t('group_detail.add_person')}
            selected={false}
            onPress={() => { onClose(); onAddPerson(); }}
          />
          <SheetOption
            icon="link-outline"
            label={t('group_detail.invite_link')}
            selected={false}
            onPress={() => { onClose(); onShareInvite(); }}
          />
          {/* T-101: reconectar a un miembro que reinstaló y perdió su clave de grupo.
              Abre la misma pantalla de escanear contacto, directo en modo cámara. */}
          <SheetOption
            icon="qr-code-outline"
            label={t('group_detail.validate_member')}
            selected={false}
            onPress={() => { onClose(); router.push('/contact/add?mode=scan' as any); }}
          />
        </>
      )}
      {group && currentUser && (
        esYo(group.createdById) ? (
          <SheetOption
            icon="trash-outline"
            label={t('group_detail.delete_group')}
            selected={false}
            onPress={() => {
              onClose();
              Alert.alert(
                t('group_detail.delete_title'),
                t('group_detail.delete_body', { name: group.name }),
                [
                  { text: t('common.cancel'), style: 'cancel' },
                  {
                    text: t('common.delete'),
                    style: 'destructive',
                    onPress: () => { deleteGroup(group.id); router.back(); },
                  },
                ],
              );
            }}
          />
        ) : (
          <SheetOption
            icon="exit-outline"
            label={t('group_detail.leave_group')}
            selected={false}
            onPress={() => { onClose(); onLeave(); }}
          />
        )
      )}
    </BottomSheet>
  );
}
