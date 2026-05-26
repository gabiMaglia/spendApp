import { appSchema, tableSchema } from '@nozbe/watermelondb';

// Campos de sync presentes en todas las tablas
const syncFields = [
  { name: 'updated_at', type: 'number' as const },
  { name: 'is_deleted', type: 'boolean' as const },
];

export const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'users',
      columns: [
        ...syncFields,
        { name: 'name',          type: 'string'  },
        { name: 'email',         type: 'string'  },
        { name: 'username',      type: 'string',  isOptional: true },
        { name: 'avatar_url',    type: 'string',  isOptional: true },
        { name: 'auth_provider', type: 'string'  }, // 'google' | 'apple'
        { name: 'created_at',    type: 'number'  },
      ],
    }),

    tableSchema({
      name: 'groups',
      columns: [
        ...syncFields,
        { name: 'name',           type: 'string' },
        { name: 'currency',       type: 'string' }, // CurrencyCode
        { name: 'member_ids',     type: 'string' }, // JSON: string[]
        { name: 'deletion_votes', type: 'string' }, // JSON: DeletionVote[]
        { name: 'created_at',     type: 'number' },
        { name: 'created_by_id',  type: 'string' },
      ],
    }),

    tableSchema({
      name: 'expenses',
      columns: [
        ...syncFields,
        { name: 'group_id',       type: 'string'  },
        { name: 'description',    type: 'string'  },
        { name: 'amount',         type: 'number'  },
        { name: 'currency',       type: 'string'  },
        { name: 'paid_by_id',     type: 'string'  },
        { name: 'splits',         type: 'string'  }, // JSON: Split[]
        { name: 'split_mode',     type: 'string'  }, // SplitMode
        { name: 'category',       type: 'string'  }, // ExpenseCategory
        { name: 'date',           type: 'number'  },
        { name: 'created_at',     type: 'number'  },
        { name: 'created_by_id',  type: 'string'  },
        { name: 'note',           type: 'string',  isOptional: true },
        { name: 'receipt_image_uri', type: 'string', isOptional: true },
        { name: 'deletion_votes', type: 'string'  }, // JSON: DeletionVote[]
      ],
    }),

    tableSchema({
      name: 'payments',
      columns: [
        ...syncFields,
        { name: 'group_id',        type: 'string'  },
        { name: 'from_user_id',    type: 'string'  },
        { name: 'to_user_id',      type: 'string'  },
        { name: 'amount',          type: 'number'  },
        { name: 'currency',        type: 'string'  },
        { name: 'target_currency', type: 'string',  isOptional: true },
        { name: 'exchange_rate',   type: 'number',  isOptional: true },
        { name: 'date',            type: 'number'  },
        { name: 'created_at',      type: 'number'  },
        { name: 'created_by_id',   type: 'string'  },
        { name: 'note',            type: 'string',  isOptional: true },
      ],
    }),
  ],
});
