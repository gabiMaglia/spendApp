import { useCallback } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useContactosConHistorial } from '@/src/store/selectors';
import { hapticWarning } from '@/src/utils/haptics';
import { useContacts } from './useContacts';

/** Lista de contactos (sin uno mismo) + acciones estables de borrar/saldar. */
export function useFriendsContacts() {
  const { t } = useTranslation();
  const { currentUser } = useAuthStore();
  const removeUser = useUserStore(s => s.removeUser);
  const conHistorial = useContactosConHistorial(currentUser?.id ?? '');

  // Criterio compartido con `app/contact/add.tsx` (T-197): usuarios activos,
  // sin uno mismo — ver `useContacts`.
  const contacts = useContacts();

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

  return { contacts, conHistorial, handleRemove, handleSettle };
}
