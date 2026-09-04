import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from '../schema';
import { sanitizeArray } from '../jsonSanitizers';
import {
  UserModel, GroupModel, ExpenseModel, PaymentModel, PersonalEntryModel,
} from '../models';
import type ExpenseModelT from '../models/Expense';
import type PersonalEntryModelT from '../models/PersonalEntry';

describe('WatermelonDB schema (ADR-001)', () => {
  it('define las 5 tablas del ADR-001 (incl. personal_entries, amend Q-05)', () => {
    expect(schema.version).toBe(1);
    expect(Object.keys(schema.tables).sort()).toEqual(
      ['expenses', 'groups', 'payments', 'personal_entries', 'users'],
    );
  });

  it('expenses: amount entero, group_id + updated_at indexados, tombstone, splits @json', () => {
    const cols = schema.tables.expenses.columns;
    expect(cols.amount.type).toBe('number');   // entero menor unidad (ADR-002)
    expect(cols.group_id.isIndexed).toBe(true);
    expect(cols.updated_at.isIndexed).toBe(true);
    expect(cols.is_deleted.type).toBe('boolean');
    expect(cols.splits).toBeDefined();
  });

  it('personal_entries: amount entero + tombstone + updated_at indexado', () => {
    const cols = schema.tables.personal_entries.columns;
    expect(cols.amount.type).toBe('number');
    expect(cols.is_deleted.type).toBe('boolean');
    expect(cols.updated_at.isIndexed).toBe(true);
  });
});

describe('sanitizeArray (@json)', () => {
  it('devuelve el array cuando lo es', () => {
    expect(sanitizeArray([1, 2])).toEqual([1, 2]);
  });
  it('devuelve [] ante dato corrupto / no-array (nunca null/undefined)', () => {
    expect(sanitizeArray(null)).toEqual([]);
    expect(sanitizeArray(undefined)).toEqual([]);
    expect(sanitizeArray('x' as unknown)).toEqual([]);
    expect(sanitizeArray({} as unknown)).toEqual([]);
  });
});

describe('modelos WatermelonDB (adapter LokiJS en memoria)', () => {
  function makeDb() {
    const adapter = new LokiJSAdapter({
      schema,
      useWebWorker: false,
      useIncrementalIndexedDB: false,
    });
    return new Database({
      adapter,
      modelClasses: [UserModel, GroupModel, ExpenseModel, PaymentModel, PersonalEntryModel],
    });
  }

  it('crea/lee un expense: PK = UUID cliente (R-03), amount entero, splits embebidos, tombstone', async () => {
    const db = makeDb();
    await db.write(async () => {
      await db.get<ExpenseModelT>('expenses').create((rec) => {
        rec._raw.id = 'e1'; // R-03: UUID de cliente como PK
        rec.groupId = 'g1';
        rec.description = 'Cena';
        rec.currency = 'ARS';
        rec.amount = 150000; // $1.500,00 en menor unidad
        rec.paidById = 'u1';
        rec.splits = [{ userId: 'u1', amount: 75000, isPaid: false }];
        rec.splitMode = 'equal';
        rec.category = 'food';
        rec.date = 0;
        rec.createdAt = 0;
        rec.createdById = 'u1';
        rec.deletionVotes = [];
        rec.updatedAt = 10;
        rec.isDeleted = false;
      });
    });

    const read = await db.get<ExpenseModelT>('expenses').find('e1');
    expect(read.id).toBe('e1');
    expect(read.amount).toBe(150000);
    expect(read.splits).toEqual([{ userId: 'u1', amount: 75000, isPaid: false }]);
    expect(read.updatedAt).toBe(10);
    expect(read.isDeleted).toBe(false);
  });

  it('personal_entry: guarda y lee kind income + amount entero', async () => {
    const db = makeDb();
    await db.write(async () => {
      await db.get<PersonalEntryModelT>('personal_entries').create((rec) => {
        rec._raw.id = 'pe1';
        rec.kind = 'income';
        rec.description = 'Sueldo';
        rec.amount = 500000;
        rec.currency = 'ARS';
        rec.category = 'salary';
        rec.date = 0;
        rec.createdAt = 0;
        rec.updatedAt = 5;
        rec.isDeleted = false;
      });
    });
    const read = await db.get<PersonalEntryModelT>('personal_entries').find('pe1');
    expect(read.kind).toBe('income');
    expect(read.amount).toBe(500000);
  });
});
