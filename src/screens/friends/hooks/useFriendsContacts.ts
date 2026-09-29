import { useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useContactosConHistorial, useDirectedDebts } from '@/src/store/selectors';
import { hapticWarning } from '@/src/utils/haptics';
import { useContacts } from './useContacts';

/** Lista de contactos (sin uno mismo) + acciones estables de borrar/saldar. */
export function useFriendsContacts() {
  const { t } = useTranslation();
  const { currentUser } = useAuthStore();
  const removeUser = useUserStore(s => s.removeUser);
  const conHistorial = useContactosConHistorial(currentUser?.id ?? '');
  const deudas = useDirectedDebts(currentUser?.id ?? '');

  // T-225 (PO 2026-09-29): «Saldar» se ofrece si YO le debo algo, aunque el
  // neto de la tarjeta diga que me debe más. Ids canónicos, como `conHistorial`.
  const aQuienesDebo = useMemo(
    () => new Set(deudas.filter(d => d.iOwe > 0).map(d => d.userId)),
    [deudas],
  );

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

  // Sin monto ni grupo: desde Amigos se salda el total en cada grupo compartido
  // y la pantalla lo calcula sola (T-225).
  const handleSettle = useCallback((id: string) => {
    router.push({ pathname: '/settle/new', params: { toId: id } } as any);
  }, []);

  return { contacts, conHistorial, aQuienesDebo, handleRemove, handleSettle };
}
