import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { useRecurringStore } from '@/src/store/recurringStore';
import { useCommentStore } from '@/src/store/commentStore';
import { usePersonalStore } from '@/src/store/personalStore';

export interface SyncDelta {
  version: 1;
  fromUserId: string;
  timestamp: number;
  groups: ReturnType<typeof useGroupStore.getState>['groups'];
  expenses: ReturnType<typeof useExpenseStore.getState>['expenses'];
  payments: ReturnType<typeof usePaymentStore.getState>['payments'];
  users: ReturnType<typeof useUserStore.getState>['users'];
  /** Plantillas recurrentes. Opcional: los deltas de versiones previas no la traen. */
  recurring?: ReturnType<typeof useRecurringStore.getState>['recurring'];
  /** Comentarios. Opcional por la misma razón. */
  comments?: ReturnType<typeof useCommentStore.getState>['comments'];
  /** Movimientos personales. Opcional por la misma razón. */
  personal?: ReturnType<typeof usePersonalStore.getState>['entries'];
}

/** Genera el delta completo del dispositivo actual para compartir por QR. */
export function buildDelta(currentUserId: string): SyncDelta {
  return {
    version:     1,
    fromUserId:  currentUserId,
    timestamp:   Date.now(),
    groups:      useGroupStore.getState().groups,
    expenses:    useExpenseStore.getState().expenses,
    payments:    usePaymentStore.getState().payments,
    users:       useUserStore.getState().users,
    recurring:   useRecurringStore.getState().recurring,
    comments:    useCommentStore.getState().comments,
    personal:    usePersonalStore.getState().entries,
  };
}

/**
 * Aplica un delta recibido del otro dispositivo.
 * Usa LWW (Last-Write-Wins) por updatedAt en cada store.
 * También vincula usuarios placeholder con la cuenta real del remitente.
 */
export function applyDelta(delta: SyncDelta, currentUserId: string): void {
  if (delta.version !== 1) return;

  useGroupStore.getState().mergeGroups(delta.groups);
  useExpenseStore.getState().mergeExpenses(delta.expenses);
  usePaymentStore.getState().mergePayments(delta.payments);

  // Merge usuarios — filtra el propio currentUser para no pisarlo
  const externalUsers = delta.users.filter(u => u.id !== currentUserId);
  useUserStore.getState().mergeUsers(externalUsers);

  // Las plantillas recurrentes viajan como cualquier otro registro (LWW).
  // Los deltas viejos no las traen: se toleran con ?? [] en vez de romper.
  useRecurringStore.getState().mergeRecurring(delta.recurring ?? []);
  useCommentStore.getState().mergeComments(delta.comments ?? []);
  usePersonalStore.getState().mergeEntries(delta.personal ?? []);
}

/** Serializa el delta a string JSON comprimido para el QR. */
export function deltaToQRString(delta: SyncDelta): string {
  return JSON.stringify(delta);
}

/** Parsea el string del QR a un SyncDelta. Lanza si el formato es inválido. */
export function parseDeltaFromQR(raw: string): SyncDelta {
  const data = JSON.parse(raw) as SyncDelta;
  if (data.version !== 1) throw new Error('Versión de sync no soportada');
  return data;
}
