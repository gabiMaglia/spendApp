import { useMemo } from 'react';

import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { esYo } from '@/src/store/identityAlias';
import type { User } from '@/src/types/models';

/**
 * Lista de contactos: usuarios activos, sin uno mismo. Mismo criterio que
 * usaba `useFriendsContacts` a mano — extraído acá (T-197) para que
 * `app/contact/add.tsx` (detectar altas mientras se muestra el QR) lo
 * comparta en vez de duplicarlo.
 */
export function useContacts(): User[] {
  const { currentUser } = useAuthStore();
  const users = useUserStore(s => s.users);

  return useMemo(
    () => users.filter(u => !u.isDeleted && !esYo(u.id)),
    // `currentUser` no aparece en el cuerpo pero la dependencia es REAL: `esYo`
    // lee la sesión activa, así que cambiar de cuenta tiene que recalcular esto.
    // El linter no puede ver esa dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, currentUser],
  );
}
