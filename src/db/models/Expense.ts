import { Model } from '@nozbe/watermelondb';
import { date, field, json, readonly, text } from '@nozbe/watermelondb/decorators';
import type { DeletionVote, ExpenseCategory, Split, SplitMode } from '@/src/types/models';
import type { CurrencyCode } from '@/src/constants/currencies';

export class Expense extends Model {
  static table = 'expenses';

  @text('group_id')      groupId!: string;
  @text('description')   description!: string;
  @field('amount')       amount!: number;
  @text('currency')      currency!: CurrencyCode;
  @text('paid_by_id')    paidById!: string;
  @text('split_mode')    splitMode!: SplitMode;
  @text('category')      category!: ExpenseCategory;
  @field('date')         date!: number;
  @text('created_by_id') createdById!: string;
  @field('updated_at')   updatedAt!: number;
  @field('is_deleted')   isDeleted!: boolean;
  @text('note')          note!: string | null;
  @text('receipt_image_uri') receiptImageUri!: string | null;
  @readonly @date('created_at') createdAt!: Date;

  @json('splits',         raw => (Array.isArray(raw) ? raw : []))  splits!: Split[];
  @json('deletion_votes', raw => (Array.isArray(raw) ? raw : []))  deletionVotes!: DeletionVote[];
}
