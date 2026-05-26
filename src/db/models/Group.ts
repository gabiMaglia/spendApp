import { Model } from '@nozbe/watermelondb';
import { date, field, json, readonly, text } from '@nozbe/watermelondb/decorators';
import type { DeletionVote } from '@/src/types/models';
import type { CurrencyCode } from '@/src/constants/currencies';

export class Group extends Model {
  static table = 'groups';

  @text('name')          name!: string;
  @text('currency')      currency!: CurrencyCode;
  @text('created_by_id') createdById!: string;
  @field('updated_at')   updatedAt!: number;
  @field('is_deleted')   isDeleted!: boolean;
  @readonly @date('created_at') createdAt!: Date;

  @json('member_ids',     raw => (Array.isArray(raw) ? raw : []))  memberIds!: string[];
  @json('deletion_votes', raw => (Array.isArray(raw) ? raw : []))  deletionVotes!: DeletionVote[];
}
