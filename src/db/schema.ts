// WatermelonDB schema — ADR-001 (engram/02_architecture.md).
//
// Convenciones (ADR-001 §Schema):
// - Columnas snake_case; la PK es la columna reservada `id` de WatermelonDB,
//   a la que el código fija el UUID de cliente (`_raw.id = model.id`, R-03).
// - `updated_at` es SIEMPRE un `number` gestionado a mano por nuestro código
//   (LWW manual) — NUNCA se usa el tipo `@date` auto-gestionado de WatermelonDB
//   (ver ADR-001 §Alternativas descartadas: auto-bumpear rompería la comparación
//   LWW al mergear un registro entrante del peer).
// - `is_deleted` es el tombstone (R-01/R-02): nunca DELETE físico.
// - Las columnas monetarias (`amount`, `exchange_rate`) son SIEMPRE enteros en
//   la menor unidad de la moneda (ADR-002) — nunca floats.
// - `Split[]` y `DeletionVote[]` van embebidos como JSON (columnas `splits` /
//   `deletion_votes`), NO como tablas propias (ver ADR-001 §Alternativas
//   descartadas: bajo LWW por-registro, un split y su expense padre con
//   timestamps independientes podrían generar un merge parcial imposible).
// - Reservadas `_status`/`_changed` de WatermelonDB existen pero NO se usan:
//   el motor de sync es el `SyncEngine` LWW propio (`src/sync/`), no el de
//   WatermelonDB.
import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'users',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'email', type: 'string' },
        { name: 'username', type: 'string', isOptional: true },
        { name: 'avatar_url', type: 'string', isOptional: true },
        { name: 'auth_provider', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number', isIndexed: true },
        { name: 'is_deleted', type: 'boolean', isIndexed: true },
      ],
    }),
    tableSchema({
      name: 'groups',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'member_ids', type: 'string' }, // @json string[] embebido
        { name: 'currency', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'created_by_id', type: 'string' },
        { name: 'default_split_mode', type: 'string', isOptional: true },
        { name: 'deletion_votes', type: 'string' }, // @json DeletionVote[] embebido
        { name: 'updated_at', type: 'number', isIndexed: true },
        { name: 'is_deleted', type: 'boolean', isIndexed: true },
      ],
    }),
    tableSchema({
      name: 'expenses',
      columns: [
        // group_id indexado: delta por grupo (R-08) + getByGroupId.
        { name: 'group_id', type: 'string', isIndexed: true },
        { name: 'description', type: 'string' },
        { name: 'currency', type: 'string' },
        { name: 'amount', type: 'number' }, // entero menor unidad (ADR-002)
        { name: 'paid_by_id', type: 'string' },
        { name: 'splits', type: 'string' }, // @json Split[] embebido (amount embebido = entero, ADR-002)
        { name: 'split_mode', type: 'string' },
        { name: 'category', type: 'string' },
        { name: 'date', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'created_by_id', type: 'string' },
        { name: 'note', type: 'string', isOptional: true },
        { name: 'receipt_image_uri', type: 'string', isOptional: true },
        { name: 'deletion_votes', type: 'string' }, // @json DeletionVote[] embebido
        { name: 'updated_at', type: 'number', isIndexed: true },
        { name: 'is_deleted', type: 'boolean', isIndexed: true },
      ],
    }),
    tableSchema({
      name: 'payments',
      columns: [
        { name: 'group_id', type: 'string', isIndexed: true },
        { name: 'from_user_id', type: 'string' },
        { name: 'to_user_id', type: 'string' },
        { name: 'amount', type: 'number' }, // entero menor unidad (ADR-002)
        { name: 'currency', type: 'string' },
        { name: 'target_currency', type: 'string', isOptional: true },
        { name: 'exchange_rate', type: 'number', isOptional: true }, // entero escalado (ADR-002 §exchange_rate)
        { name: 'date', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'created_by_id', type: 'string' },
        { name: 'note', type: 'string', isOptional: true },
        { name: 'updated_at', type: 'number', isIndexed: true },
        { name: 'is_deleted', type: 'boolean', isIndexed: true },
      ],
    }),
    tableSchema({
      name: 'personal_entries',
      columns: [
        { name: 'kind', type: 'string' }, // 'expense'|'income'|'group_replicated'|'carryover'
        { name: 'description', type: 'string' },
        { name: 'amount', type: 'number' }, // entero menor unidad (ADR-002); siempre positivo
        { name: 'currency', type: 'string' },
        { name: 'category', type: 'string' },
        { name: 'date', type: 'number' },
        { name: 'created_at', type: 'number' },
        // Indexado: lo usa updateReplicatedEntry (personalStore.ts:68-70).
        { name: 'source_group_expense_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'source_group_id', type: 'string', isOptional: true },
        { name: 'source_group_name', type: 'string', isOptional: true },
        { name: 'is_positive_carryover', type: 'boolean', isOptional: true },
        { name: 'updated_at', type: 'number', isIndexed: true },
        { name: 'is_deleted', type: 'boolean', isIndexed: true },
      ],
    }),
  ],
});
