import { useAuthStore } from './authStore';
import { useGroupStore } from './groupStore';
import { useArchiveStore } from './archiveStore';
import { useExpenseStore } from './expenseStore';
import { usePaymentStore } from './paymentStore';
import { useUserStore } from './userStore';
import { usePersonalStore } from './personalStore';
import { useRecurringStore } from './recurringStore';
import { useCommentStore } from './commentStore';
import { useGroupKeyStore } from './groupKeyStore';
import { purgeMergedScopes } from './accountLink';
import { migrarReplicadosUnaVez } from '@/src/services/runMigrateReplicated';
import { startRelay } from '@/src/sync/relayEngine';
import { materializeRecurring } from '@/src/services/materializeRecurring';
import { resolvePendingDeletions } from '@/src/services/resolveDeletions';
import { applyApprovedLeaves } from '@/src/services/applyLeave';
import { useSettingsStore } from './settingsStore';
import { useNoticeInboxStore } from './noticeInboxStore';
import { reloadVerdictCache } from '@/src/sync/verdictCache';
import { reloadAuthorKeys } from '@/src/sync/authorKeys';
import { reloadRatchet } from '@/src/sync/ratchet';
import { reloadRecordHealth } from '@/src/sync/recordHealth';
import { reloadAuthorHealth } from '@/src/sync/authorHealth';

// (Re)hidrata todos los stores scopeados por cuenta con los datos del usuario
// activo. Con usuario nulo (deslogueado), cada hydrate lee un scope vacío y deja
// el store limpio → ninguna cuenta ve los datos de otra.
export function rehydrateForActiveUser(): void {
  useGroupStore.getState().hydrate();
  useArchiveStore.getState().hydrate();
  useExpenseStore.getState().hydrate();
  usePaymentStore.getState().hydrate();
  useUserStore.getState().hydrate();
  usePersonalStore.getState().hydrate();
  useRecurringStore.getState().hydrate();
  useCommentStore.getState().hydrate();
  useGroupKeyStore.getState().hydrate();
  useSettingsStore.getState().hydrate();
  useNoticeInboxStore.getState().hydrate();

  /**
   * Las cachés y la medición de T-041 también son POR CUENTA, y no son stores:
   * viven en variables de módulo con lectura perezosa desde el scope activo.
   * Sin soltarlas acá, una cuenta que entra después de otra en el mismo arranque
   * seguiría leyendo los veredictos, las claves y los contadores de la anterior
   * —y peor, `guardar()` los escribiría bajo el scope de la nueva.
   *
   * Es un hueco que quedó de S3 y S4; cuesta una línea cada uno y dejarlo sería
   * dejar una filtración conocida entre cuentas.
   *
   * `authorHealth` es de ADR-004, no de T-041, y por eso se le había escapado a
   * la revisión que cerró los otros cuatro: la medición de la fase B tenía el
   * mismo agujero. Lo encontró el guard ampliado de T-055, que es exactamente
   * para lo que existe.
   */
  reloadVerdictCache();
  reloadAuthorKeys();
  reloadRatchet();
  reloadRecordHealth();
  reloadAuthorHealth();

  // Con los datos de la cuenta ya cargados, se materializan los gastos
  // recurrentes vencidos. Va acá y no en el arranque de la app porque depende
  // de QUÉ cuenta está activa: cada una tiene sus propias plantillas.
  applyDueRecurring();

  // Solicitudes de borrado cuyas 72hs ya vencieron sin objeción. Va acá y no en
  // un temporizador: mientras la app está cerrada no hay nada que ejecutar, y
  // el vencimiento se evalúa igual de bien al volver.
  resolvePendingDeletions();

  // Salidas de grupo que ya juntaron todas las aprobaciones. Misma razón que
  // arriba: la firma que faltaba pudo haber llegado por sync mientras la app
  // estaba cerrada.
  applyApprovedLeaves();

  // Migración one-shot de las réplicas de grupo (ADR-006). Va DESPUÉS de que
  // los stores hidrataron: necesita los gastos y los movimientos ya cargados.
  migrarReplicadosUnaVez();

  // Limpieza tardía de scopes fusionados que ya pasaron el período de gracia.
  purgeMergedScopes();

  // Sync en tiempo real de la cuenta activa: se suscribe a los grupos con clave
  // y drena lo que quedó encolado mientras la app estuvo cerrada. Va acá y no
  // en el arranque global porque los grupos y sus claves son POR CUENTA.
  void startRelay();

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
