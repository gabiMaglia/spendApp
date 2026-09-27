import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useContactosConHistorial } from '@/src/store/selectors';
import { hapticWarning, hapticSelection } from '@/src/utils/haptics';
import { esYo } from '@/src/store/identityAlias';
import { block, unblock, blockedIds } from '@/src/sync/blockedPeers';

/** Lista de contactos (sin uno mismo) + acciones estables de borrar/saldar/bloquear. */
export function useFriendsContacts() {
  const { t } = useTranslation();
  const { currentUser } = useAuthStore();
  const users = useUserStore(s => s.users);
  const removeUser = useUserStore(s => s.removeUser);
  const conHistorial = useContactosConHistorial(currentUser?.id ?? '');

  const contacts = useMemo(
    () => users.filter(u => !u.isDeleted && !esYo(u.id)),
    // `currentUser` no aparece en el cuerpo pero la dependencia es REAL: `esYo`
    // lee la sesión activa, así que cambiar de cuenta tiene que recalcular esto.
    // El linter no puede ver esa dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, currentUser],
  );

  // `blockedPeers` no es un store reactivo (relee el storage en cada llamada,
  // a propósito — mismo criterio que `contactChannel.listPeers`), así que la
  // pantalla necesita este contador para volver a preguntarle después de
  // bloquear/desbloquear.
  const [blockedTick, setBlockedTick] = useState(0);
  const blocked = useMemo(
    () => new Set(blockedIds()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blockedTick, currentUser],
  );

  // Callbacks ESTABLES (PO 2026-09-22, rendimiento en gama baja — mismo
  // patrón que `GroupRow` en Grupos): antes eran arrow functions inline
  // dentro del `.map()`, así que envolver `ContactRow` en `React.memo`
  // servía de poco — esas props "cambiaban" en cada render igual.
  const handleRemove = useCallback((id: string, name: string) => {
    hapticWarning();
    Alert.alert(
      t('friends.remove_title'),
      t('friends.remove_body', { name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => removeUser(id) },
      ],
    );
  }, [t, removeUser]);

  const handleSettle = useCallback((id: string, amount: number, currency: string) => {
    router.push({
      pathname: '/settle/new',
      params: { toId: id, maxAmount: String(Math.abs(amount)), currency },
    } as any);
  }, []);

  // T-180 (7.1): bloquear pide confirmación (es una acción que corta un
  // canal); desbloquear no la necesita — es reversible con el mismo toque.
  const handleToggleBlock = useCallback((id: string, name: string) => {
    if (blockedIds().includes(id)) {
      hapticSelection();
      unblock(id);
      setBlockedTick(n => n + 1);
      return;
    }
    hapticWarning();
    Alert.alert(
      t('contacts.block_confirm_title', { name }),
      t('contacts.block_confirm_body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('contacts.block'),
          style: 'destructive',
          onPress: () => { block(id); setBlockedTick(n => n + 1); },
        },
      ],
    );
  }, [t]);

  return { contacts, conHistorial, blocked, handleRemove, handleSettle, handleToggleBlock };
}
