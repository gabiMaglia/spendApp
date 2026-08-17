import type {
  Group, Expense, Payment, User, PersonalEntry, PersonalBudget,
  RecurringExpense, ExpenseComment,
} from '@/src/types/models';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useRecurringStore } from '@/src/store/recurringStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useAuthStore } from '@/src/store/authStore';

/**
 * Backup completo `.splitp2p`: exporta TODOS los datos locales a un archivo JSON
 * versionado y los re-importa con semántica **RESTORE (reemplazo)**: importar
 * deja los datos EXACTAMENTE como en el archivo (revierte cambios, descarta lo
 * agregado después del export). Decisión PO 2026-07-21.
 *
 * También refresca `authStore.currentUser` (de donde sale el nombre del perfil)
 * con el registro del usuario de sesión que venga en el backup.
 */

export const BACKUP_FORMAT = 'splitp2p-backup' as const;
export const BACKUP_VERSION = 1 as const;

export interface BackupFile {
  format:          typeof BACKUP_FORMAT;
  version:         typeof BACKUP_VERSION;
  exportedAt:      number;
  groups:          Group[];
  expenses:        Expense[];
  payments:        Payment[];
  users:           User[];
  personalEntries: PersonalEntry[];
  personalBudget:  PersonalBudget;
  /** Opcionales: los backups hechos antes de estas features no los traen. */
  recurring?:      RecurringExpense[];
  comments?:       ExpenseComment[];
}

/** Arma el backup leyendo el estado actual de todos los stores. */
export function buildBackup(): BackupFile {
  return {
    format:          BACKUP_FORMAT,
    version:         BACKUP_VERSION,
    exportedAt:      Date.now(),
    groups:          useGroupStore.getState().groups,
    expenses:        useExpenseStore.getState().expenses,
    payments:        usePaymentStore.getState().payments,
    users:           useUserStore.getState().users,
    personalEntries: usePersonalStore.getState().entries,
    personalBudget:  usePersonalStore.getState().budget,
    recurring:       useRecurringStore.getState().recurring,
    comments:        useCommentStore.getState().comments,
  };
}

/** Serializa el backup a string JSON (indentado, para que el archivo sea legible). */
export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2);
}

const ARRAY_KEYS = ['groups', 'expenses', 'payments', 'users', 'personalEntries'] as const;

/**
 * Parsea y VALIDA el contenido de un archivo `.splitp2p`. Lanza `Error` con
 * mensaje claro si el JSON es inválido, el formato/versión no coincide, o falta
 * alguna colección. No aplica nada — solo devuelve el `BackupFile` validado.
 */
export function parseBackup(raw: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('backup.error_invalid_json');
  }

  if (typeof data !== 'object' || data === null) {
    throw new Error('backup.error_invalid_format');
  }
  const obj = data as Record<string, unknown>;

  if (obj.format !== BACKUP_FORMAT) {
    throw new Error('backup.error_invalid_format');
  }
  if (obj.version !== BACKUP_VERSION) {
    throw new Error('backup.error_unsupported_version');
  }
  for (const key of ARRAY_KEYS) {
    if (!Array.isArray(obj[key])) {
      throw new Error('backup.error_invalid_format');
    }
  }
  if (typeof obj.personalBudget !== 'object' || obj.personalBudget === null) {
    throw new Error('backup.error_invalid_format');
  }

  return data as BackupFile;
}

/**
 * Restaura (REEMPLAZA) el estado de los stores con el contenido del backup.
 * Técnica: vaciar cada colección y luego `mergeXxx` sobre `[]` ⇒ el resultado es
 * exactamente el backup (el merge sobre vacío agrega todo). Así se descarta lo
 * que no esté en el archivo, sin agregar métodos nuevos a los stores.
 */
export function applyBackup(backup: BackupFile): void {
  useGroupStore.setState({ groups: [] });
  useGroupStore.getState().mergeGroups(backup.groups);

  useExpenseStore.setState({ expenses: [] });
  useExpenseStore.getState().mergeExpenses(backup.expenses);

  usePaymentStore.setState({ payments: [] });
  usePaymentStore.getState().mergePayments(backup.payments);

  useUserStore.setState({ users: [] });
  useUserStore.getState().mergeUsers(backup.users);

  usePersonalStore.setState({ entries: [] });
  usePersonalStore.getState().mergeEntries(backup.personalEntries);
  usePersonalStore.getState().setBudget(backup.personalBudget);

  // Plantillas recurrentes y comentarios. Van con el mismo criterio RESTORE
  // (reemplazo) que el resto: si el backup no los trae —porque es anterior a
  // estas features— quedan vacíos, coherente con restaurar ese snapshot.
  useRecurringStore.setState({ recurring: [] });
  useRecurringStore.getState().mergeRecurring(backup.recurring ?? []);

  useCommentStore.setState({ comments: [] });
  useCommentStore.getState().mergeComments(backup.comments ?? []);

  // El nombre del perfil sale de authStore (no de userStore): refrescar el
  // usuario de sesión con su registro restaurado, si viene en el backup.
  const current = useAuthStore.getState().currentUser;
  if (current) {
    const restored = backup.users.find(u => u.id === current.id);
    if (restored) useAuthStore.getState().setUser(restored);
  }
}

/** Conveniencia: parsea desde string y aplica en un paso. */
export function importBackup(raw: string): void {
  applyBackup(parseBackup(raw));
}

/** Nombre de archivo sugerido para el export, con fecha local. */
export function backupFileName(now: number = Date.now()): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `splitp2p-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.splitp2p`;
}
