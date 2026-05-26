import { Model } from '@nozbe/watermelondb';
import { date, field, readonly, text } from '@nozbe/watermelondb/decorators';
import type { CurrencyCode } from '@/src/constants/currencies';

export class Payment extends Model {
  static table = 'payments';

  @text('group_id')        groupId!: string;
  @text('from_user_id')    fromUserId!: string;
  @text('to_user_id')      toUserId!: string;
  @field('amount')         amount!: number;
  @text('currency')        currency!: CurrencyCode;
  @text('target_currency') targetCurrency!: CurrencyCode | null;
  @field('exchange_rate')  exchangeRate!: number | null;
  @field('date')           date!: number;
  @text('created_by_id')   createdById!: string;
  @field('updated_at')     updatedAt!: number;
  @field('is_deleted')     isDeleted!: boolean;
  @text('note')            note!: string | null;
  @readonly @date('created_at') createdAt!: Date;
}
