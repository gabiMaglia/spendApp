import { useAuthStore } from './authStore';
import { useGroupStore } from './groupStore';
import { useExpenseStore } from './expenseStore';
import { usePaymentStore } from './paymentStore';
import { useUserStore } from './userStore';
import { usePersonalStore } from './personalStore';
import { useSettingsStore } from './settingsStore';

// (Re)hidrata todos los stores scopeados por cuenta con los datos del usuario
// activo. Con usuario nulo (deslogueado), cada hydrate lee un scope vacío y deja
// el store limpio → ninguna cuenta ve los datos de otra.
export function rehydrateForActiveUser(): void {
  useGroupStore.getState().hydrate();
  useExpenseStore.getState().hydrate();
  usePaymentStore.getState().hydrate();
  useUserStore.getState().hydrate();
  usePersonalStore.getState().hydrate();
  useSettingsStore.getState().hydrate();

  // El usuario logueado debe estar en SUS propios contactos. Se hace acá (no en
  // authStore.setUser) para que corra DESPUÉS de que el scope ya cambió al nuevo
  // usuario, y así se persista en el namespace correcto.
  const user = useAuthStore.getState().currentUser;
  if (user) useUserStore.getState().addOrUpdateUser(user);
}

// Suscribe la re-hidratación a los cambios de cuenta activa (login / logout /
// switch). Devuelve el unsubscribe. Se engancha una vez en el root layout.
export function subscribeSessionRehydrate(): () => void {
  let prevId = useAuthStore.getState().currentUser?.id ?? null;
  return useAuthStore.subscribe((state) => {
    const nextId = state.currentUser?.id ?? null;
    if (nextId !== prevId) {
      prevId = nextId;
      rehydrateForActiveUser();
    }
  });
}
