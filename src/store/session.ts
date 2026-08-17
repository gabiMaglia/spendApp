import { useAuthStore } from './authStore';
import { useGroupStore } from './groupStore';
import { useExpenseStore } from './expenseStore';
import { usePaymentStore } from './paymentStore';
import { useUserStore } from './userStore';
import { usePersonalStore } from './personalStore';
import { useRecurringStore } from './recurringStore';
import { useCommentStore } from './commentStore';
import { purgeMergedScopes } from './accountLink';
import { materializeRecurring } from '@/src/services/materializeRecurring';
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
  useRecurringStore.getState().hydrate();
  useCommentStore.getState().hydrate();
  useSettingsStore.getState().hydrate();

  // Con los datos de la cuenta ya cargados, se materializan los gastos
  // recurrentes vencidos. Va acá y no en el arranque de la app porque depende
  // de QUÉ cuenta está activa: cada una tiene sus propias plantillas.
  applyDueRecurring();

  // Limpieza tardía de scopes fusionados que ya pasaron el período de gracia.
  purgeMergedScopes();

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

/**
 * Materializa los gastos recurrentes vencidos de la cuenta activa.
 *
 * No hay servidor ni tarea de fondo: esto corre al abrir la app y al cambiar de
 * cuenta. Es idempotente (cada plantilla recuerda su último vencimiento), así
 * que llamarlo de más no duplica nada.
 */
export function applyDueRecurring(now: number = Date.now()): void {
  const templates = useRecurringStore.getState().recurring;
  if (templates.length === 0) return;

  const { expenses, personalEntries, updatedTemplates } = materializeRecurring(templates, now);

  // mergeXxx en vez de addXxx: los ids son deterministas, así que si el gasto
  // ya llegó por sync P2P desde el otro device, se colapsa en vez de duplicar.
  if (expenses.length > 0) useExpenseStore.getState().mergeExpenses(expenses);
  if (personalEntries.length > 0) usePersonalStore.getState().mergeEntries(personalEntries);

  for (const t of updatedTemplates) {
    useRecurringStore.getState().updateRecurring(t.id, { lastMaterializedAt: t.lastMaterializedAt });
  }
}
