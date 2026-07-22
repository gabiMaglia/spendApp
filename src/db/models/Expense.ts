// Modelo WatermelonDB para `expenses` (ADR-001). `splits` y `deletionVotes`
// van embebidos como JSON — un split y su expense padre NUNCA deben tener
// timestamps LWW independientes (ver ADR-001 §Alternativas descartadas).
// `amount` (y cada `Split.amount` embebido) es SIEMPRE entero en la menor
// unidad de la moneda (ADR-002) — nunca float.
import { Model } from '@nozbe/watermelondb';
import { field, json } from '@nozbe/watermelondb/decorators';
import type { Split, DeletionVote } from '@/src/types/models';
import { sanitizeArray } from './jsonSanitizers';

export default class ExpenseModel extends Model {
  static table = 'expenses';

  // Indexado: delta por grupo (R-08) + getByGroupId.
  @field('group_id') groupId!: string;
  @field('description') description!: string;
  @field('currency') currency!: string;
  @field('amount') amount!: number; // entero menor unidad (ADR-002)
  @field('paid_by_id') paidById!: string;
  @json('splits', sanitizeArray) splits!: Split[];
  @field('split_mode') splitMode!: string;
  @field('category') category!: string;
  @field('date') date!: number;
  @field('created_at') createdAt!: number;
  @field('created_by_id') createdById!: string;
  @field('note') note!: string | null;
  @field('receipt_image_uri') receiptImageUri!: string | null;
  @json('deletion_votes', sanitizeArray) deletionVotes!: DeletionVote[];

  // LWW manual (ADR-001 §Alternativas descartadas) — NUNCA @date auto-gestionado.
  @field('updated_at') updatedAt!: number;
  // Tombstone (R-01/R-02) — nunca DELETE físico.
  @field('is_deleted') isDeleted!: boolean;
}
