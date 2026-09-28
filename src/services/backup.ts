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
import { useArchiveStore, type ArchiveReason } from '@/src/store/archiveStore';
import { useSettingsStore, esMonedaSoportada, DEFAULT_DISPLAY_CURRENCY } from '@/src/store/settingsStore';
import { useLangStore, type LanguageChoice } from '@/src/store/langStore';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/src/i18n';
import { esSkinId, FALLBACK_SKIN, type SkinId } from '@/src/skins/registry';
import type { CurrencyCode } from '@/src/constants/currencies';
import { conAlta, rosterDe } from '@/src/algorithms/roster';
import { esYo, aliasPersistidos, restaurarAlias } from '@/src/store/identityAlias';
import { schedulePublish, anunciarMiTarjeta } from '@/src/sync/motor/relayEngine';
import { marcarConTopic } from '@/src/sync/motor/pendingDrain';
import { exportarContactos, restaurarContactos } from '@/src/sync/contactos/contactChannel';
import type { PeerInfo } from '@/src/sync/contactos/contactPeers';
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
 *
 * v3 (T-213, decisión PO 2026-09-28): el backup pasa a cubrir TODO lo que la
 * app persiste por cuenta — `archived`, `settings`, `contacts` y `aliases`.
 * Un archivo v1/v2 se sigue leyendo igual (`parseBackup` acepta 1, 2 y 3):
 * simplemente no trae estos campos, y `applyBackup` los trata como ausentes
 * (no toca esos stores). Ver `INCLUIDOS_BACKUP`/`EXCLUIDOS_BACKUP` más abajo
 * para el mapa completo de qué se exporta y qué se deja afuera, y por qué.
 */
export const BACKUP_VERSION = 3 as const;
const VERSIONES_SOPORTADAS = [1, 2, 3] as const;

export interface BackupFile {
  format:          typeof BACKUP_FORMAT;
  version:         typeof BACKUP_VERSION | 1 | 2;
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
  /**
   * T-213: grupos archivados (ids + motivo de cada uno). Ausente en v1/v2.
   * `applyBackup` sólo lo restaura para un backup PROPIO (`esYo(ownerId)`,
   * QA defecto 3): es una preferencia del DUEÑO del archivo, no un dato del
   * grupo — un backup ajeno no debe imponer qué archivó la otra cuenta.
   */
  archived?: {
    ids:     string[];
    reasons: Record<string, ArchiveReason>;
  };
  /**
   * T-213: preferencias persistidas de la cuenta — sólo lo que el usuario
   * eligió, nunca estado efímero. `reduceAnimations` queda AFUERA a
   * propósito: es un heurístico de gama del DISPOSITIVO
   * (`esDispositivoDeGamaBaja`), no una preferencia de la cuenta — llevarlo a
   * un teléfono distinto le impondría una elección pensada para otro
   * hardware. Ausente en v1/v2. Mismo gate que `archived` (sólo backup
   * propio, QA defecto 3).
   */
  settings?: {
    displayCurrency:   CurrencyCode;
    language:          LanguageChoice;
    skin:              SkinId;
    notifExpenses:     boolean;
    notifDeletions:    boolean;
    notifInvites:      boolean;
    notifSettlements:  boolean;
  };
  /**
   * T-213: el canal de contactos completo — el secreto PROPIO, en claro
   * (igual que `groupKeys`; `export_warning_body` ya avisa), más los peers y
   * el acuse de tarjeta enviada. Sin esto, un teléfono nuevo deja de poder
   * sincronizar con los contactos ya agregados hasta volver a escanear su
   * QR — el mismo caso que `groupKeys` sin claves. Ausente en v1/v2.
   */
  contacts?: {
    secret:    string | null;
    peers:     Record<string, PeerInfo>;
    cardSent:  Record<string, string>;
  };
  /**
   * T-213: identidades viejas de la misma persona (`identityAlias.ts`).
   * Ausente en v1/v2.
   */
  aliases?: string[];
}

// ── T-213 · Cobertura del backup ────────────────────────────────────────────
//
// `src/store/accountLink.ts` ya lleva la lista completa de qué persiste
// SCOPEADO POR CUENTA (`COBERTURA_FUSION` ∪ `EXCLUIDOS_FUSION`, con el guard
// `accountCoverage.test.ts` que la mantiene sincronizada con `src/` de
// verdad). Esta sección responde la pregunta SIGUIENTE, que es distinta:
// de todo eso, ¿qué exporta el backup? El guard de este archivo
// (`backupCobertura.guard.test.ts`) exige que cada módulo de esa lista esté
// clasificado ACÁ — en una tabla o en la otra, nunca en ninguna, nunca en
// las dos.

/** Módulo scopeado por cuenta → a qué campo de `BackupFile` va. */
export const INCLUIDOS_BACKUP: Record<string, string> = {
  'store/groupStore':      'groups',
  'store/expenseStore':    'expenses',
  'store/paymentStore':    'payments',
  'store/userStore':       'users',
  'store/recurringStore':  'recurring',
  'store/commentStore':    'comments',
  'store/personalStore':   'personalEntries + personalBudget',
  'store/groupKeyStore':   'groupKeys',
  'store/archiveStore':    'archived (ids + reasons)',
  'store/settingsStore':   'settings (displayCurrency, skin, toggles de notificación — NO reduceAnimations, ver BackupFile.settings)',
  'store/identityAlias':   'aliases',
  'sync/contactos/contactPeers':     'contacts.peers + contacts.cardSent',
  'sync/contactos/contactChannel':   'contacts.secret — a diferencia de la FUSIÓN (que lo excluye porque adoptar el de otra cuenta invalidaría códigos ya mostrados), el backup SÍ lo lleva: es un archivo propio para restaurar en OTRO dispositivo, no una fusión de dos cuentas activas — no hay códigos ajenos que invalidar.',
};

/** Módulo scopeado por cuenta → por qué el backup NO lo exporta. */
export const EXCLUIDOS_BACKUP: Record<string, string> = {
  'sync/adaptadores/hushsplit/almacen':
    'Ledger de cubos publicados y rebanadas aplicadas (T-191): caché de «¿ya lo mandé/apliqué?» de ESTE dispositivo. En otro teléfono no vale nada y sería activamente peor (declararía cubos de otro dispositivo como ya publicados); al restaurar, `marcarConTopic` fuerza una publicación y relectura completas. (T-206-A)',
  'store/noticeInboxStore':
    'Bandeja de avisos: estado de lectura LOCAL a este dispositivo, no data que alguien quiera "restaurar" — un backup que resucita avisos ya leídos como no-leídos sería peor que no llevarlos. Decisión PO T-213.',
  'sync/motor/pendingDrain':
    'Marcas "este grupo todavía no drenó su buzón" (T-089): estado transitorio de ESTE aparato sincronizando, no data de la cuenta. Restaurar una marca vieja en otro teléfono no tiene sentido — el drenaje real depende del buzón, no de esta marca; y `applyBackup` ya corre `marcarConTopic` sobre TODOS los grupos del backup, que es el mecanismo que la vuelve a poner cuando hace falta.',
  'store/identityStore':
    'La parte de este módulo que pasa por `writeScoped` es invitaciones/joins EN CURSO de este aparato (`invites_v1`/`pending_joins_v1`/`contact_invites_v1`/`contact_pending_claims_v1`), no data durable de la cuenta — se reconstruye re-emitiendo o re-aceptando la invitación. Las claves privadas del dispositivo (`identity_v1`/`owner_secret_v1`/`wrapkeys_v1`) son harina de otro costal: no pasan por `writeScoped` (por eso ni siquiera están en `COBERTURA_FUSION`/`EXCLUIDOS_FUSION`) y un teléfono nuevo genera las suyas — nunca se exportan.',
  'store/userScope':
    'No es data: es el mecanismo de scoping mismo (`writeScoped` está acá porque este módulo lo DEFINE). Mismo motivo que en `EXCLUIDOS_FUSION`.',
  'services/runMigrateReplicated':
    'Marca one-shot "esta cuenta ya migró sus réplicas" (ADR-006), no data del usuario. Restaurarla no protege nada: la migración real ya corrió o no hace falta, y de haber quedado pendiente, `rehydrateForActiveUser` la vuelve a intentar sola.',
  'sync/confianza/authorHealth':
    'Medición diagnóstica de la fase B de ADR-004 (pantalla DEV), no data del usuario — se vuelve a acumular con el uso. Mismo motivo que en `EXCLUIDOS_FUSION`.',
  'sync/confianza/verdictCache':
    'Caché de veredictos de firma ya calculados (T-041), reconstruible verificando de nuevo. Mismo motivo que en `EXCLUIDOS_FUSION`.',
  'sync/confianza/authorKeysCache':
    'Caché de públicas que el directorio ya devolvió (T-041), reconstruible consultando el directorio de nuevo. Mismo motivo que en `EXCLUIDOS_FUSION`.',
  'sync/confianza/ratchet':
    'Trinquete "a este autor ya le vimos firmar" (T-041): hoy sólo mide, no bloquea nada, y se retraba solo con la próxima firma válida. Mismo motivo que en `EXCLUIDOS_FUSION`.',
  'sync/avisos/syncDownNotices':
    'Acuse local "a este grupo ya le avisé que dejó de sincronizar", para no repetir el aviso — es el registro de algo que YA se dijo en ESTE teléfono, no data de la cuenta. Mismo motivo que en `EXCLUIDOS_FUSION`.',
  'services/noticeDedupe':
    'Dedupe persistido de avisos por reintento (T-172): mismo caso que `syncDownNotices`, el registro de "esto YA se avisó" en este dispositivo, no data de la cuenta.',
  'sync/confianza/recordHealthStore':
    'Medición diagnóstica de T-041 (cuántos registros verificaron), no data del usuario — se reacumula con el uso. Mismo motivo que en `EXCLUIDOS_FUSION`.',
  'sync/invitaciones/groupKeyOffers':
    'Ofertas de clave de grupo por remitente (T-136): estado de una decisión pendiente de ESTE teléfono ahora mismo. Restaurarlas en otro dispositivo (u horas después) no tiene sentido — las ofertas reales las reenvía `relayEngine.reenviarClavesDeGrupo` en cada arranque.',
};

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
    archived: {
      ids:     useArchiveStore.getState().archivedIds,
      reasons: useArchiveStore.getState().reasons,
    },
    settings: {
      displayCurrency:  useSettingsStore.getState().displayCurrency,
      language:         useLangStore.getState().choice,
      skin:             useSettingsStore.getState().skin,
      notifExpenses:    useSettingsStore.getState().notifExpenses,
      notifDeletions:   useSettingsStore.getState().notifDeletions,
      notifInvites:     useSettingsStore.getState().notifInvites,
      notifSettlements: useSettingsStore.getState().notifSettlements,
    },
    contacts: exportarContactos(),
    aliases:  aliasPersistidos(),
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
   *
   * T-213 (QA, defecto 3): `archived`/`settings` entran al MISMO gate, no
   * SIEMPRE como en la primera versión de este ticket. Son preferencias del
   * DUEÑO del archivo (qué idioma usa, qué grupos tiene archivados), no
   * datos del grupo que un backup ajeno trae para consulta — pisarlas con
   * las de otra persona sería el mismo tipo de apropiación que adoptar su
   * clave de grupo, sólo que de la cuenta en vez del grupo.
   */
  if (backup.ownerId !== undefined && esYo(backup.ownerId)) {
    if (backup.archived) {
      useArchiveStore.getState().restore(backup.archived.ids, backup.archived.reasons);
    }

    if (backup.settings) {
      const s = backup.settings;
      // Una moneda desconocida (backup corrupto, o de una versión futura con
      // una moneda que esta build no tiene) cae al default — mismo criterio
      // que `skin`. Sin este chequeo, `getCurrency(code)!` devuelve
      // `undefined` en runtime y el primer `formatMoney`/`minorFactor` que
      // corra revienta (QA T-213, defecto 1 bloqueante).
      useSettingsStore.getState().setDisplayCurrency(
        esMonedaSoportada(s.displayCurrency) ? s.displayCurrency : DEFAULT_DISPLAY_CURRENCY,
      );
      // Un skin desconocido (backup corrupto, o de una versión futura con un
      // skin que ésta no tiene) cae al fallback — mismo criterio que
      // `settingsStore.hydrate()` con un skin guardado inválido.
      useSettingsStore.getState().setSkin(esSkinId(s.skin) ? s.skin : FALLBACK_SKIN);
      useSettingsStore.getState().setNotifExpenses(s.notifExpenses);
      useSettingsStore.getState().setNotifDeletions(s.notifDeletions);
      useSettingsStore.getState().setNotifInvites(s.notifInvites);
      useSettingsStore.getState().setNotifSettlements(s.notifSettlements);
      // Mismo criterio: un idioma inválido no pisa el que ya estaba elegido.
      if (s.language === 'auto' || SUPPORTED_LANGUAGES.includes(s.language as SupportedLanguage)) {
        useLangStore.getState().setLanguage(s.language);
      }
    }

    if (backup.groupKeys?.length) {
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

    /**
     * T-213 · contactos + alias — mismo gate que las claves de grupo, y por
     * la misma razón: adoptar el secreto de contacto o los alias de OTRA
     * cuenta activa mezclaría el canal de dos personas distintas.
     */
    if (backup.contacts) {
      restaurarContactos(backup.contacts);
      // Mismo disparo que `schedulePublish` hace para las claves de grupo:
      // sin esto el canal queda restaurado pero mudo hasta el PRÓXIMO
      // arranque de la app (`startRelay` ya llama a `anunciarMiTarjeta` en
      // cada arranque — esto sólo adelanta ese primer aviso a AHORA, para
      // que los contactos vean la tarjeta sin esperar a que se reabra la app).
      void anunciarMiTarjeta();
    }

    if (backup.aliases) {
      restaurarAlias(backup.aliases);
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
