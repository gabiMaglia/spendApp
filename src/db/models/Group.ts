// Modelo WatermelonDB para `groups` (ADR-001). `memberIds` y `deletionVotes`
// van embebidos como JSON (no son tablas propias — ver ADR-001 §Alternativas
// descartadas).
import { Model } from '@nozbe/watermelondb';
import { field, json } from '@nozbe/watermelondb/decorators';
import type { DeletionVote } from '@/src/types/models';
import { sanitizeArray } from './jsonSanitizers';

export default class GroupModel extends Model {
  static table = 'groups';

  @field('name') name!: string;
  @json('member_ids', sanitizeArray) memberIds!: string[];
  @field('currency') currency!: string;
  @field('created_at') createdAt!: number;
  @field('created_by_id') createdById!: string;
  @field('default_split_mode') defaultSplitMode!: string | null;
  @json('deletion_votes', sanitizeArray) deletionVotes!: DeletionVote[];

  // LWW manual (ADR-001 §Alternativas descartadas) — NUNCA @date auto-gestionado.
  @field('updated_at') updatedAt!: number;
  // Tombstone (R-01/R-02) — nunca DELETE físico.
  @field('is_deleted') isDeleted!: boolean;
}
