import { Alert } from 'react-native';
import { router } from 'expo-router';
import { v4 as uuidv4 } from 'uuid';
import { useTranslation } from 'react-i18next';

import { hapticSuccess } from '@/src/utils/haptics';
import { normalizePayers } from '@/src/algorithms/payers';
import type { RecurrenceValue } from '@/src/components/RecurrencePicker';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useRecurringStore } from '@/src/store/recurringStore';
import { useTierStore } from '@/src/store/tierStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { motivoDeExceso } from '@/src/services/topeDeRegistro';
import { syncedNow } from '@/src/utils/syncedClock';
import { esYo } from '@/src/store/identityAlias';
import type {
  Expense, ExpenseCategory, Group, Payer, PersonalCategory, User,
} from '@/src/types/models';
import type { SplitCalculado, SplitMode } from '@/src/screens/expense/repartoDeGasto';

export type FormularioDeGasto = {
  currentUser: User | null;
  isEditMode: boolean;
  expenseId?: string;
  existingExpense?: Expense;
  hasGroup: boolean;
  groupId: string;
  group?: Group;
  description: string;
  amount: number;
  currency: CurrencyCode;
  category: PersonalCategory;
  date: Date;
  note: string;
  receiptUri?: string;
  isIncome: boolean;
  payerId: string;
  multiPayer: boolean;
  payers: Payer[];
  splits: SplitCalculado[];
  splitMode: SplitMode;
  recurrence: RecurrenceValue;
  needsAd: boolean;
  canSave: boolean;
};

/**
 * Guardar de Nuevo gasto (T-223: salió de `app/expense/new.tsx`). Tres
 * caminos: entrada personal (sin grupo), edición de un gasto de grupo, alta
 * de un gasto de grupo. Más la plantilla de repetición si se eligió una.
 */
export function useGuardarGasto(f: FormularioDeGasto): () => void {
  const { t } = useTranslation();
  const incrementCount = useTierStore(s => s.incrementCount);
  const addExpense = useExpenseStore(s => s.addExpense);
  const updateExpense = useExpenseStore(s => s.updateExpense);
  const addPersonalEntry = usePersonalStore(s => s.addEntry);
  const updateReplicatedEntry = usePersonalStore(s => s.updateReplicatedEntry);
  const addRecurring = useRecurringStore(st => st.addRecurring);

  /** Desglose de pagadores listo para guardar (o el pagador único). */
  function payerFields(): { paidById: string; payers: Payer[] | undefined } {
    // `payers: undefined` explícito, no ausente: se aplica con spread al editar,
    // y una clave ausente dejaría vivo el desglose anterior.
    if (!f.multiPayer) return { paidById: f.payerId || f.currentUser!.id, payers: undefined };
    return normalizePayers(f.payers);
  }

  /**
   * Si el usuario eligió repetición, además del gasto de hoy se guarda la
   * PLANTILLA. `lastMaterializedAt` arranca en la fecha de este gasto para que
   * el materializador no vuelva a crear el que se acaba de crear a mano.
   */
  function saveRecurringTemplate() {
    if (f.recurrence === null || !f.currentUser) return;
    const at = f.date.getTime();
    addRecurring({
      id:          uuidv4(),
      groupId:     f.hasGroup ? f.groupId : '',
      description: f.description.trim(),
      amount:      f.amount,
      currency:    f.currency,
      ...payerFields(),
      splitMode:   f.splitMode,
      memberIds:   f.splits.map(sp => sp.userId),
      category:    f.category as ExpenseCategory,
      rule:        { frequency: f.recurrence, startDate: at },
      lastMaterializedAt: at,
      isActive:    true,
      createdAt:   Date.now(),
      createdById: f.currentUser.id,
      updatedAt:   syncedNow(),
      isDeleted:   false,
    });
  }

  function guardarPersonal() {
    // Sin grupo → entrada PERSONAL (gasto o ingreso). Sin ad gate/splits/pagador. (F-G/F-G2)
    hapticSuccess();
    addPersonalEntry({
      id:          uuidv4(),
      kind:        f.isIncome ? 'income' : 'expense',
      description: f.description.trim(),
      amount:      f.amount,
      currency:    f.currency,
      // Sin selector para Ingreso, el estado ya llega en 'other' — pero se
      // fuerza acá también para que un ingreso NUNCA pueda guardar otra
      // cosa, sea cual sea el camino que trajo `category` hasta acá.
      category:    f.isIncome ? 'other' : f.category,
      date:        f.date.getTime(),
      createdAt:   Date.now(),
      updatedAt:   syncedNow(),
      isDeleted:   false,
    });
    saveRecurringTemplate();
    router.back();
  }

  /** Devuelve false si no guardó (la pantalla queda abierta con el aviso). */
  function guardarEdicion(splitPayload: Expense['splits'], myShare: number, groupName: string): boolean {
    const cambios = {
      description:     f.description.trim(),
      amount:          f.amount,
      ...payerFields(),
      splits:          splitPayload,
      splitMode:       f.splitMode,
      category:        f.category as ExpenseCategory,
      date:            f.date.getTime(),
      note:            f.note || undefined,
      receiptImageUri: f.receiptUri,
    };
    // T-178 (6.4): el mismo predicado que hoy sólo corre al publicar/recibir
    // corre ACÁ antes de escribir — si no, el registro queda huérfano en
    // este teléfono, sin viajar nunca y sin que nadie se entere.
    const motivo = motivoDeExceso({ ...f.existingExpense, ...cambios });
    if (motivo) {
      Alert.alert(t('sync.record_too_big_title'), t(motivo));
      return false;
    }
    const guardo = updateExpense(f.expenseId!, cambios);
    // T-152 · D2: si el núcleo ya estaba firmado y no se pudo re-firmar esta
    // edición, el store la bloqueó — no la guardó — para no perderla en
    // silencio contra la próxima republicación de la versión vieja. Se le
    // avisa a quien editaba y la pantalla NO se cierra, como si hubiera
    // guardado.
    if (!guardo) {
      Alert.alert(t('sync.sign_failed_title'), t('sync.sign_failed_body'));
      return false;
    }
    // T-172 (ítem 4): recién ACÁ se sabe que guardó de verdad. Antes el
    // haptic sonaba junto con el gate del anuncio, así que un bloqueo por
    // firma vibraba "éxito" un instante antes del Alert de error.
    hapticSuccess();
    // Keep personal replica in sync with edited values
    if (myShare > 0) {
      updateReplicatedEntry(f.expenseId!, {
        description:     f.description.trim(),
        amount:          myShare,
        category:        f.category,
        date:            f.date.getTime(),
        sourceGroupName: groupName,
      });
    }
    return true;
  }

  /** Devuelve false si no guardó (la pantalla queda abierta con el aviso). */
  function guardarAlta(splitPayload: Expense['splits'], groupName: string): boolean {
    const newId = uuidv4();
    const nuevo = {
      id:              newId,
      groupId:         f.groupId,
      description:     f.description.trim(),
      amount:          f.amount,
      currency:        f.currency,
      ...payerFields(),
      splits:          splitPayload,
      splitMode:       f.splitMode,
      category:        f.category as ExpenseCategory,
      date:            f.date.getTime(),
      createdAt:       Date.now(),
      createdById:     f.currentUser!.id,
      note:            f.note || undefined,
      receiptImageUri: f.receiptUri,
      updatedAt:       syncedNow(),
      isDeleted:       false,
    };
    // T-178 (6.4): mismo gate que en la edición, antes de escribir.
    const motivo = motivoDeExceso(nuevo);
    if (motivo) {
      Alert.alert(t('sync.record_too_big_title'), t(motivo));
      return false;
    }
    addExpense(nuevo);
    // Un alta nueva no tiene núcleo previo firmado que re-firmar: no puede
    // bloquearse como una edición (T-152 · D2), así que el haptic va sin gate.
    hapticSuccess();
    // ADR-006: se replica lo que SALIÓ DE MI BOLSILLO, no mi porción.
    // Si pagó otro, todavía no gasté nada — es una deuda, y se vuelve gasto
    // recién cuando la salde. Antes se replicaba `myShare` siempre, que
    // estaba mal en los dos sentidos: de menos si pagaba yo, y de más si
    // pagaba otro.
    if (esYo(payerFields().paidById)) {
      addPersonalEntry({
        id:                   uuidv4(),
        kind:                 'group_replicated',
        description:          f.description.trim(),
        amount:               f.amount,
        currency:             f.currency,
        category:             f.category,
        date:                 f.date.getTime(),
        createdAt:            Date.now(),
        updatedAt:            syncedNow(),
        isDeleted:            false,
        sourceGroupExpenseId: newId,
        sourceGroupId:        f.groupId,
        sourceGroupName:      groupName,
      });
    }
    incrementCount(f.currentUser!.id);
    saveRecurringTemplate();
    return true;
  }

  return function guardar() {
    if (!f.canSave || !f.currentUser) return;
    if (!f.hasGroup) { guardarPersonal(); return; }

    // Cuando exista el anuncio, acá va: mostrarlo y guardar recién al terminar.
    // Hasta entonces `needsAd` es siempre false — un `return` seco dejaba el
    // botón muerto y la app sin poder guardar gastos, en silencio.
    if (f.needsAd) return;

    const splitPayload = f.splits.map(s => ({
      userId: s.userId,
      amount: s.amount,
      isPaid: f.payerId ? s.userId === f.payerId : esYo(s.userId),
    }));
    const myShare = splitPayload.find(s => esYo(s.userId))?.amount ?? 0;
    const groupName = f.group?.name ?? '';

    const guardo = f.isEditMode && f.expenseId
      ? guardarEdicion(splitPayload, myShare, groupName)
      : guardarAlta(splitPayload, groupName);
    if (guardo) router.back();
  };
}
