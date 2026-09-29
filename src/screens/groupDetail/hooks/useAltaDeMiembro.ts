import { Alert } from 'react-native';
import { v4 as uuidv4 } from 'uuid';
import { useTranslation } from 'react-i18next';

import { hapticSuccess } from '@/src/utils/haptics';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { admiteUnMiembroMas, MAX_MIEMBROS } from '@/src/sync/nucleo/topes';
import { motivoDeExceso } from '@/src/services/topeDeRegistro';
import { announceGroupToContacts } from '@/src/sync/motor/relayEngine';
import { conAlta } from '@/src/algorithms/roster';
import { syncedNow } from '@/src/utils/syncedClock';
import type { Group } from '@/src/types/models';

/**
 * Las dos formas de sumar a alguien desde la hoja «Agregar persona»: un
 * contacto con la app, o un nombre suelto para quien no la tiene.
 * T-223: salió de `app/groups/[id].tsx`.
 */
export function useAltaDeMiembro(group: Group | undefined, cerrarHoja: () => void) {
  const { t } = useTranslation();
  const ensureKey       = useGroupKeyStore(st => st.ensureKey);
  const updateGroup     = useGroupStore(s => s.updateGroup);
  const addOrUpdateUser = useUserStore(s => s.addOrUpdateUser);

  function handleAddContact(userId: string) {
    if (!group) return;
    // T-150 ronda 2 (D4): un grupo nunca supera MAX_MIEMBROS por un camino
    // honesto de la UI.
    if (!admiteUnMiembroMas(group.memberIds)) {
      Alert.alert(t('group_detail.member_limit_title'), t('group_detail.member_limit_body', { max: MAX_MIEMBROS }));
      return;
    }
    const conAltaResult = conAlta(group, userId, syncedNow());
    // T-178 (6.4): mismo gate, defensa en profundidad además del tope de
    // arriba (que ya cubre `memberIds`; esto cubre bytes de cualquier otro
    // campo que el grupo traiga acumulado).
    const motivo = motivoDeExceso(conAltaResult);
    if (motivo) {
      Alert.alert(t('sync.record_too_big_title'), t(motivo));
      return;
    }
    hapticSuccess();
    updateGroup(group.id, { miembros: conAltaResult.miembros });
    ensureKey(group.id);
    void announceGroupToContacts(group.id);
    cerrarHoja();
  }

  function handleAddMemberSinApp(rawName: string) {
    const name = rawName.trim();
    if (!name || !group) return;
    // T-150 ronda 2 (D4): mismo tope que handleAddContact, por este otro camino.
    if (!admiteUnMiembroMas(group.memberIds)) {
      Alert.alert(t('group_detail.member_limit_title'), t('group_detail.member_limit_body', { max: MAX_MIEMBROS }));
      return;
    }

    const newUser = {
      id:           uuidv4(),
      name,
      email:        '',
      authProvider: 'google' as const,
      updatedAt:    syncedNow(),
      isDeleted:    false,
      createdAt:    Date.now(),
    };
    const conAltaResult = conAlta(group, newUser.id, syncedNow());
    const motivo = motivoDeExceso(conAltaResult);
    if (motivo) {
      Alert.alert(t('sync.record_too_big_title'), t(motivo));
      return;
    }

    addOrUpdateUser(newUser);
    updateGroup(group.id, { miembros: conAltaResult.miembros });
    ensureKey(group.id);
    void announceGroupToContacts(group.id);
    hapticSuccess();
    cerrarHoja();
    Alert.alert(t('group_detail.member_added_title'), t('group_detail.without_app_warning'));
  }

  return { handleAddContact, handleAddMemberSinApp };
}
