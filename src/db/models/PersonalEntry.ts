// Modelo WatermelonDB para `personal_entries` (ADR-001, amend Q-05).
// `amount` entero en la menor unidad de la moneda (ADR-002); siempre positivo.
import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export default class PersonalEntryModel extends Model {
  static table = 'personal_entries';

  @field('kind') kind!: 'expense' | 'income' | 'group_replicated' | 'carryover';
  @field('description') description!: string;
  @field('amount') amount!: number; // entero menor unidad (ADR-002); siempre positivo
  @field('currency') currency!: string;
  @field('category') category!: string;
  @field('date') date!: number;
  @field('created_at') createdAt!: number;
  // Indexado: lo usa updateReplicatedEntry (personalStore.ts:68-70).
  @field('source_group_expense_id') sourceGroupExpenseId!: string | null;
  @field('source_group_id') sourceGroupId!: string | null;
  @field('source_group_name') sourceGroupName!: string | null;
  @field('is_positive_carryover') isPositiveCarryover!: boolean | null;

  // LWW manual (ADR-001 §Alternativas descartadas) — NUNCA @date auto-gestionado.
  @field('updated_at') updatedAt!: number;
  // Tombstone (R-01/R-02) — nunca DELETE físico.
  @field('is_deleted') isDeleted!: boolean;
}
