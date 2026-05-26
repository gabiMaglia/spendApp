import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { schema } from './schema';
import { Expense } from './models/Expense';
import { Group } from './models/Group';
import { Payment } from './models/Payment';

const adapter = new SQLiteAdapter({
  schema,
  dbName: 'splitp2p',
  jsi: true,   // JSI adapter para máximo rendimiento (requiere New Architecture)
  onSetUpError: error => {
    console.error('[WatermelonDB] setup error:', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [Group, Expense, Payment],
});

export { Group, Expense, Payment };
