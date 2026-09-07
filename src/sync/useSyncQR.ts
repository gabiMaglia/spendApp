import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { useRecurringStore } from '@/src/store/recurringStore';
import { useCommentStore } from '@/src/store/commentStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { observeRecords, type LocalCore } from './recordHealth';
import { sinAvatarUrl, sinCamposLocales } from './soloLocal';
import { mismaPersona } from '@/src/store/identityAlias';

/**
 * Versión de FEATURES del delta, aparte de `version` (que es el formato).
 *
 * `version` no se puede tocar: `applyDelta` descarta el delta entero si no es 1,
 * así que subirla haría que un peer viejo ignore TODO en silencio — peor que el
 * problema que queremos resolver. Este campo es opcional y sólo sirve para
 * DETECTAR con quién estamos hablando: si llega un delta sin él, el otro
 * dispositivo tiene una versión anterior a los gastos con varios pagadores, y
 * va a mostrar balances distintos a los nuestros (acredita el total al pagador
 * principal porque ignora el desglose). No se puede arreglar de este lado, pero
 * sí avisarle al usuario en vez de dejarlo descubrir números que no cuadran.
 */
export const DELTA_FEATURE_VERSION = 2;

export interface SyncDelta {
  version: 1;
  /** Ausente ⇒ el peer es anterior a DELTA_FEATURE_VERSION. */
  featureVersion?: number;
  fromUserId: string;
  timestamp: number;
  groups: ReturnType<typeof useGroupStore.getState>['groups'];
  expenses: ReturnType<typeof useExpenseStore.getState>['expenses'];
  payments: ReturnType<typeof usePaymentStore.getState>['payments'];
  users: ReturnType<typeof useUserStore.getState>['users'];
  /** Plantillas recurrentes. Opcional: los deltas de versiones previas no la traen. */
  recurring?: ReturnType<typeof useRecurringStore.getState>['recurring'];
  /**
   * Claves de grupo. **SÓLO viajan por este delta**, que va por el pairing QR:
   * un canal autenticado por presencia física. NUNCA por el relay — si el relay
   * pudiera entregar claves podría sustituirlas por las suyas y leer todo
   * (ADR-003 §1). El payload del relay se arma con `buildRelayPayload`, que no
   * las incluye, y hay un test que lo verifica.
   */
  groupKeys?: ReturnType<typeof useGroupKeyStore.getState>['keys'];
  /** Comentarios. Opcional por la misma razón. */
  comments?: ReturnType<typeof useCommentStore.getState>['comments'];
  /** Movimientos personales. Opcional por la misma razón. */
  personal?: ReturnType<typeof usePersonalStore.getState>['entries'];
}

/** Genera el delta completo del dispositivo actual para compartir por QR. */
export function buildDelta(currentUserId: string): SyncDelta {
  return {
    version:        1,
    featureVersion: DELTA_FEATURE_VERSION,
    fromUserId:  currentUserId,
    timestamp:   Date.now(),
    groups:      useGroupStore.getState().groups,
    // Sin los campos que no significan nada en el otro teléfono. Ver `soloLocal`.
    expenses:    sinCamposLocales(useExpenseStore.getState().expenses),
    payments:    usePaymentStore.getState().payments,
    users:       sinAvatarUrl(useUserStore.getState().users),
    recurring:   useRecurringStore.getState().recurring,
    comments:    useCommentStore.getState().comments,
    groupKeys:   useGroupKeyStore.getState().keys,
    personal:    usePersonalStore.getState().entries,
  };
}

/**
 * Qué `rev` tenemos ya de cada id, para el descarte barato de la medición.
 *
 * `rev` ausente cuenta como 0 —es todo lo anterior a T-041— y por eso el mapa
 * guarda el número y no el registro: hay que poder distinguir "no lo tenemos"
 * de "lo tenemos sin `rev`", que son cosas distintas y se veían iguales.
 */
function revLocal<T extends { id: string; rev?: number }>(
  lista: readonly T[],
): (id: string) => LocalCore {
  const previos = new Map<string, number>();
  for (const r of lista) previos.set(r.id, r.rev ?? 0);
  return id => {
    const rev = previos.get(id);
    return rev === undefined ? undefined : { rev };
  };
}

/**
 * **El gate de T-041 · S6: se verifica, se cuenta, y no cambia nada** (R1).
 *
 * Va acá y no en `drainGroup` porque las tres puertas de entrada —el relay, el
 * QR y el pairing P2P— desembocan en `applyDelta`: en el transporte quedarían
 * dos bypass.
 *
 * Corre **antes** de los merges a propósito: el descarte por `rev` compara
 * contra lo que este device tiene ahora, y después de mergear ya sería tarde.
 *
 * Y va envuelta en un `try`: la medición no puede tener poder de veto ni por
 * accidente. Si observar explota, el merge corre igual — un registro que no se
 * pudo medir se muestra y suma como cualquier otro.
 */
function observeDelta(delta: SyncDelta): void {
  try {
    observeRecords('group', delta.groups, revLocal(useGroupStore.getState().groups));
    observeRecords('expense', delta.expenses, revLocal(useExpenseStore.getState().expenses));
    observeRecords('payment', delta.payments, revLocal(usePaymentStore.getState().payments));
    observeRecords('comment', delta.comments ?? [], revLocal(useCommentStore.getState().comments));
    observeRecords('recurring', delta.recurring ?? [],
      revLocal(useRecurringStore.getState().recurring));
  } catch {
    // `users`, `personal` y `groupKeys` no entran: los dos primeros no tienen
    // núcleo económico firmable y los `PersonalEntry` no viajan por el relay
    // (§9 del plan); las claves de grupo tienen su propia autenticación por el
    // canal de contactos.
  }
}

/**
 * Aplica un delta recibido del otro dispositivo.
 * Usa LWW (Last-Write-Wins) por updatedAt en cada store.
 * También vincula usuarios placeholder con la cuenta real del remitente.
 */
export function applyDelta(delta: SyncDelta, currentUserId: string): void {
  if (delta.version !== 1) return;

  observeDelta(delta);

  useGroupStore.getState().mergeGroups(delta.groups);
  useExpenseStore.getState().mergeExpenses(delta.expenses);
  usePaymentStore.getState().mergePayments(delta.payments);

  /**
   * Merge usuarios — filtra el propio perfil para no pisarlo, **incluidas mis
   * identidades viejas** (T-048). Un peer republica el estado completo del
   * grupo, así que el perfil que yo escribí con la cuenta anterior vuelve en
   * cada sobre: sin `mismaPersona`, entraba al store como si fuera otra
   * persona y me aparecía a mí mismo en la lista de contactos y en los saldos.
   *
   * Es `mismaPersona` y no `idCanonico` porque este módulo arma el delta que
   * VIAJA: acá sólo puede entrar un primitivo que devuelva un booleano.
   */
  const externalUsers = delta.users.filter(u => !mismaPersona(u.id, currentUserId));
  useUserStore.getState().mergeUsers(externalUsers);

  // Las plantillas recurrentes viajan como cualquier otro registro (LWW).
  // Los deltas viejos no las traen: se toleran con ?? [] en vez de romper.
  useRecurringStore.getState().mergeRecurring(delta.recurring ?? []);
  useCommentStore.getState().mergeComments(delta.comments ?? []);
  usePersonalStore.getState().mergeEntries(delta.personal ?? []);
  // Canal autenticado por QR: acá SÍ se adoptan claves (nunca desde el relay).
  useGroupKeyStore.getState().adoptKeys(delta.groupKeys ?? []);
}

/**
 * ¿El otro dispositivo tiene una versión anterior?
 * Si es así, los gastos con varios pagadores se le van a ver distinto: ignora el
 * desglose y le acredita el total al pagador principal.
 */
export function peerIsOutdated(delta: SyncDelta): boolean {
  return (delta.featureVersion ?? 1) < DELTA_FEATURE_VERSION;
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
