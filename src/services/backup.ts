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
import { useGroupKeyStore, type GroupKeyRecord } from '@/src/store/groupKeyStore';
import { conAlta, rosterDe } from '@/src/algorithms/roster';
import { esYo } from '@/src/store/identityAlias';
import { schedulePublish } from '@/src/sync/motor/relayEngine';
import { marcarConTopic } from '@/src/sync/motor/pendingDrain';
import { syncedNow } from '@/src/utils/syncedClock';

/**
 * Backup completo `.hushsplit`: exporta TODOS los datos locales a un archivo JSON
 * versionado y los re-importa con semántica **RESTORE (reemplazo)**: importar
 * deja los datos EXACTAMENTE como en el archivo (revierte cambios, descarta lo
 * agregado después del export). Decisión PO 2026-07-21.
 *
 * También refresca `authStore.currentUser` (de donde sale el nombre del perfil)
 * con el registro del usuario de sesión que venga en el backup.
 */

/** Tag INTERNO del archivo; no es marca. Queda «splitp2p» a propósito: cambiarlo dejaría sin abrir los backups ya exportados. */
export const BACKUP_FORMAT = 'splitp2p-backup' as const;
/**
 * v2 (T-188b, decisión PO 2026-09-27): el archivo pasa a llevar `ownerId` y
 * `groupKeys` — EN CLARO, como todo el resto del archivo (T-124 SEC L-F ya
 * documentó que el backup no va cifrado). Un archivo v1 se sigue leyendo
 * (`parseBackup` acepta 1 y 2): simplemente no trae claves, y `applyBackup`
 * restaura los datos igual, sin re-entrar a ningún grupo ni adoptar nada.
 */
export const BACKUP_VERSION = 2 as const;
const VERSIONES_SOPORTADAS = [1, 2] as const;

export interface BackupFile {
  format:          typeof BACKUP_FORMAT;
  version:         typeof BACKUP_VERSION | 1;
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
  /** T-188b: de quién es este archivo. Ausente en v1. */
  ownerId?:        string;
  /**
   * T-188b: las claves de cifrado de cada grupo, en claro. Sin esto restaurar
   * en OTRO teléfono deja los grupos legibles pero SIN forma de sincronizar
   * (no hay con qué derivar el topic ni descifrar lo que llegue). Ausente en
   * v1 — esos backups no las llevaban.
   */
  groupKeys?:      GroupKeyRecord[];
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
    ownerId:         useAuthStore.getState().currentUser?.id,
    groupKeys:       useGroupKeyStore.getState().keys,
  };
}

/** Serializa el backup a string JSON (indentado, para que el archivo sea legible). */
export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2);
}

const ARRAY_KEYS = ['groups', 'expenses', 'payments', 'users', 'personalEntries'] as const;

/**
 * Parsea y VALIDA el contenido de un archivo `.hushsplit`. Lanza `Error` con
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
  if (!VERSIONES_SOPORTADAS.includes(obj.version as typeof VERSIONES_SOPORTADAS[number])) {
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

  /**
   * V1 (verifier, T-191 segunda tanda): un restore REEMPLAZA los stores de
   * cada grupo — no es un merge incremental. El cursor del topic, el ledger
   * de cubos publicados y las rebanadas ya aplicadas de otros emisores
   * (`appliedSlices`) siguen apuntando al estado de ANTES del restore. Sin
   * resetearlos, un manifiesto futuro que declare las MISMAS ckeys de
   * siempre se da por cumplido contra aplicaciones de un mundo que el
   * restore acaba de borrar — hasta 20 días de datos incompletos (la
   * ventana de renovación), sin ningún error visible.
   *
   * `adoptKeys` (el camino de T-188b, más abajo) SÓLO llama a
   * `marcarConTopic` cuando ve un cambio de clave/época — con la MISMA
   * clave (el caso normal: restaurar un backup propio en el mismo
   * dispositivo, o en uno nuevo pero ya emparejado) no ve ningún cambio y
   * nunca dispara nada. Por eso esto corre ACÁ, incondicional al `ownerId`
   * del backup: cualquier grupo con clave local, restaurado o no por T-188b,
   * tiene sus stores recién reemplazados y necesita el mismo reset.
   */
  void marcarConTopic(backup.groups.map(g => g.id));

  // El nombre del perfil sale de authStore (no de userStore): refrescar el
  // usuario de sesión con su registro restaurado, si viene en el backup.
  const current = useAuthStore.getState().currentUser;
  if (current) {
    const restored = backup.users.find(u => u.id === current.id);
    if (restored) useAuthStore.getState().setUser(restored);
  }

  /**
   * T-188b · claves + re-entrada — **sólo si el backup es MÍO**.
   *
   * `esYo` (no una comparación literal): cubre también un `ownerId` que sea un
   * alias mío de una fusión de cuentas vieja (T-048), no sólo el id activo.
   * Un backup AJENO (`ownerId` de otra persona, importado con confirmación
   * explícita en la pantalla) trae los datos —igual que siempre, RESTORE— pero
   * NUNCA sus claves ni un alta mía: adoptar la clave de un grupo que no es
   * mío sería leer conversaciones ajenas sin haber sido invitado, y darse de
   * alta ahí es autoinvitarse a un grupo de otra persona.
   */
  if (backup.ownerId !== undefined && esYo(backup.ownerId) && backup.groupKeys?.length) {
    useGroupKeyStore.getState().adoptKeys(backup.groupKeys);

    const ahora = syncedNow();
    const idsConClave = new Set(backup.groupKeys.map(k => k.groupId));
    for (const g of backup.groups) {
      // Sin la clave no hay con qué publicar ni descifrar lo que vuelva: no
      // tiene sentido re-entrar a un grupo que se quedó sin canal.
      if (!idsConClave.has(g.id)) continue;
      const local = useGroupStore.getState().getById(g.id);
      if (!local || rosterDe(local.miembros).includes(current!.id)) continue;

      // `at` FRESCO (`ahora`, no el que traía el archivo): el borrado (T-187)
      // pudo haber publicado un `conBaja` más reciente que cualquier timestamp
      // del backup — sin un `at` nuevo, la re-entrada perdería ese merge por
      // LWW y quedaría fantasma para los demás.
      useGroupStore.setState({
        groups: useGroupStore.getState().groups.map(x =>
          x.id === g.id ? conAlta(x, current!.id, ahora) : x),
      });
      schedulePublish(g.id, 0);
    }
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
  return `hushsplit-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.hushsplit`;
}
