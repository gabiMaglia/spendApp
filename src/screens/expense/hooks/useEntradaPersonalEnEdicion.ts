import { usePersonalStore } from '@/src/store/personalStore';
import { isEditable } from '@/src/algorithms/entryOrigin';
import type { CurrencyCode } from '@/src/constants/currencies';
import type { PersonalCategory } from '@/src/types/models';

export type PrecargaPersonal = {
  description: string;
  amount: number;
  currency: CurrencyCode;
  category: PersonalCategory;
  date: Date;
  isIncome: boolean;
};

/**
 * Entrada personal que la pantalla de gasto está editando (T-257).
 *
 * Sólo las MANUALES: una derivada, borrada o con id que ya no existe no abre
 * edición — el formulario quedaría vacío y guardaría una entrada nueva.
 */
export function useEntradaPersonalEnEdicion(personalEntryId: string | undefined): {
  inicial: PrecargaPersonal | undefined;
  editing: boolean;
} {
  const found = usePersonalStore(s =>
    personalEntryId ? s.entries.find(e => e.id === personalEntryId && !e.isDeleted) : undefined,
  );
  if (!found || !isEditable(found)) return { inicial: undefined, editing: false };
  return {
    editing: true,
    inicial: {
      description: found.description, amount: found.amount, currency: found.currency,
      category: found.category, date: new Date(found.date), isIncome: found.kind === 'income',
    },
  };
}

/** Clave i18n del título de la pantalla de gasto. */
export function claveDeTitulo(isEditMode: boolean, isIncome: boolean): string {
  if (isEditMode) return isIncome ? 'expense.edit_income_title' : 'expense.edit_title';
  return isIncome ? 'expense.new_income_title' : 'expense.new_title';
}
