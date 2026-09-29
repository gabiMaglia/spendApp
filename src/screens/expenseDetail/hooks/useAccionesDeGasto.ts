import { Alert } from 'react-native';
import { router } from 'expo-router';
import { v4 as uuidv4 } from 'uuid';
import { useTranslation } from 'react-i18next';

import { hapticWarning } from '@/src/utils/haptics';
import { motivoDeExceso } from '@/src/services/topeDeRegistro';
import { syncedNow } from '@/src/utils/syncedClock';
import { useExpenseStore } from '@/src/store/expenseStore';
import type { Expense, ExpenseComment, User } from '@/src/types/models';

/**
 * Comentar y borrar desde el Detalle de gasto. Va ARRIBA del early return de
 * la pantalla (es un hook), por eso recibe el gasto como opcional.
 * T-223: salió de `app/expense/[id].tsx`.
 */
export function useAccionesDeGasto({
  id, expense, currentUser, grupoArchivado, addComment, removeCommentsForExpense,
}: {
  id: string | undefined;
  expense: Expense | undefined;
  currentUser: User | null;
  grupoArchivado: boolean;
  addComment: (comment: ExpenseComment) => void;
  removeCommentsForExpense: (expenseId: string) => void;
}) {
  const { t } = useTranslation();
  const updateExpense = useExpenseStore(s => s.updateExpense);

  function handleAddComment(text: string) {
    if (grupoArchivado) {
      Alert.alert(t('groups.archived_readonly_title'), t('groups.archived_readonly_hint'));
      return;
    }
    if (!currentUser || !id) return;
    const now = syncedNow();
    const nuevo = {
      id:        uuidv4(),
      expenseId: id,
      authorId:  currentUser.id,
      text,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
    };
    // T-178 (6.4): mismo gate que en los otros formularios, antes de escribir.
    const motivo = motivoDeExceso(nuevo);
    if (motivo) {
      Alert.alert(t('sync.record_too_big_title'), t(motivo));
      return;
    }
    addComment(nuevo);
  }

  /**
   * Se borra ya, sin ventana para objetar — cualquier miembro del grupo, o el
   * creador (T-186: se sacó el modo «con acuerdo»).
   */
  function borrarGasto() {
    if (!currentUser || !expense) return;
    updateExpense(expense.id, {
      isDeleted: true,
      // Etiqueta LWW sin firma para que Actividad muestre quién borró.
      deletedById: currentUser.id,
    });
    // Cascada: si no, los comentarios quedan huérfanos apuntando a un gasto
    // inexistente y viajando en cada sync.
    removeCommentsForExpense(expense.id);
    router.back();
  }

  function handleRequestDelete() {
    if (grupoArchivado) {
      Alert.alert(t('groups.archived_readonly_title'), t('groups.archived_readonly_hint'));
      return;
    }
    if (!currentUser || !expense) return;
    hapticWarning();

    Alert.alert(
      t('expense.delete_title'),
      t('expense.delete_body_open'),
      [
        { text: t('common.cancel'), style: 'cancel' as const },
        { text: t('expense.delete_expense'), style: 'destructive' as const, onPress: borrarGasto },
      ],
    );
  }

  return { handleAddComment, handleRequestDelete };
}
