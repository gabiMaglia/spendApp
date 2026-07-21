import type {
  Group, Expense, Payment, User, PersonalEntry, PersonalBudget,
} from '@/src/types/models';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { usePersonalStore } from '@/src/store/personalStore';

/**
 * Backup completo `.splitp2p`: exporta TODOS los datos locales a un archivo JSON
 * versionado y los re-importa con merge LWW (Last-Write-Wins por `updatedAt`),
 * sin pisar datos más nuevos. Reusa los `mergeXxx` de cada store (misma lógica
 * que el sync P2P por QR — ver `src/sync/useSyncQR.ts`).
 *
 * El presupuesto personal (`PersonalBudget`) NO es SyncMeta (no tiene
 * `updatedAt`), así que no participa del LWW: en import se restaura solo si el
 * backup trae uno con monto > 0, para no pisar un presupuesto local con uno vacío.
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
 * Aplica un backup ya parseado a los stores, con merge LWW por `updatedAt`
 * (no clobber). El presupuesto se restaura solo si trae monto > 0.
 */
export function applyBackup(backup: BackupFile): void {
  useGroupStore.getState().mergeGroups(backup.groups);
  useExpenseStore.getState().mergeExpenses(backup.expenses);
  usePaymentStore.getState().mergePayments(backup.payments);
  useUserStore.getState().mergeUsers(backup.users);
  usePersonalStore.getState().mergeEntries(backup.personalEntries);

  if (backup.personalBudget && backup.personalBudget.monthlyAmount > 0) {
    usePersonalStore.getState().setBudget(backup.personalBudget);
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
