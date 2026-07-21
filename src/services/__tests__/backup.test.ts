import {
  buildBackup, serializeBackup, parseBackup, applyBackup, importBackup,
  backupFileName, BACKUP_FORMAT, BACKUP_VERSION, type BackupFile,
} from '../backup';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { usePersonalStore } from '@/src/store/personalStore';
import type {
  Group, Expense, Payment, User, PersonalEntry, PersonalBudget,
} from '@/src/types/models';

// ── Factories mínimas pero completas (TS estricto) ──────────────────────────
function group(id: string, updatedAt: number, over: Partial<Group> = {}): Group {
  return {
    id, updatedAt, isDeleted: false, name: `G-${id}`, memberIds: ['u1'],
    currency: 'ARS', createdAt: 0, createdById: 'u1', deletionVotes: [], ...over,
  };
}
function expense(id: string, updatedAt: number, over: Partial<Expense> = {}): Expense {
  return {
    id, updatedAt, isDeleted: false, groupId: 'g1', description: `E-${id}`,
    amount: 1000, currency: 'ARS', paidById: 'u1',
    splits: [{ userId: 'u1', amount: 1000, isPaid: false }],
    splitMode: 'equal', category: 'other', date: 0, createdAt: 0,
    createdById: 'u1', deletionVotes: [], ...over,
  };
}
function payment(id: string, updatedAt: number, over: Partial<Payment> = {}): Payment {
  return {
    id, updatedAt, isDeleted: false, groupId: 'g1', fromUserId: 'u1', toUserId: 'u2',
    amount: 500, currency: 'ARS', date: 0, createdAt: 0, createdById: 'u1', ...over,
  };
}
function user(id: string, updatedAt: number, over: Partial<User> = {}): User {
  return {
    id, updatedAt, isDeleted: false, name: `U-${id}`, email: `${id}@x.com`,
    authProvider: 'google', createdAt: 0, ...over,
  };
}
function entry(id: string, updatedAt: number, over: Partial<PersonalEntry> = {}): PersonalEntry {
  return {
    id, updatedAt, isDeleted: false, kind: 'expense', description: `P-${id}`,
    amount: 100, currency: 'ARS', category: 'other', date: 0, createdAt: 0, ...over,
  };
}
const emptyBudget: PersonalBudget = { currency: 'ARS', monthlyAmount: 0, includeOwedToMe: false };

function resetStores() {
  useGroupStore.setState({ groups: [] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  useUserStore.setState({ users: [] });
  usePersonalStore.setState({ entries: [], budget: { ...emptyBudget } });
}

beforeEach(resetStores);

describe('buildBackup / serializeBackup', () => {
  it('reúne el estado de los 5 stores + budget en un BackupFile versionado', () => {
    useGroupStore.setState({ groups: [group('g1', 10)] });
    useExpenseStore.setState({ expenses: [expense('e1', 10)] });
    usePaymentStore.setState({ payments: [payment('p1', 10)] });
    useUserStore.setState({ users: [user('u1', 10)] });
    usePersonalStore.setState({
      entries: [entry('pe1', 10)],
      budget: { currency: 'ARS', monthlyAmount: 50000, includeOwedToMe: true },
    });

    const b = buildBackup();
    expect(b.format).toBe(BACKUP_FORMAT);
    expect(b.version).toBe(BACKUP_VERSION);
    expect(b.groups).toHaveLength(1);
    expect(b.expenses[0].id).toBe('e1');
    expect(b.payments[0].id).toBe('p1');
    expect(b.users[0].id).toBe('u1');
    expect(b.personalEntries[0].id).toBe('pe1');
    expect(b.personalBudget.monthlyAmount).toBe(50000);

    // serializa a JSON válido y re-parseable
    expect(() => JSON.parse(serializeBackup(b))).not.toThrow();
  });
});

describe('parseBackup — validación', () => {
  const valid: BackupFile = {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: 0,
    groups: [], expenses: [], payments: [], users: [], personalEntries: [],
    personalBudget: emptyBudget,
  };

  it('acepta un backup válido', () => {
    expect(parseBackup(JSON.stringify(valid)).format).toBe(BACKUP_FORMAT);
  });
  it('rechaza JSON inválido', () => {
    expect(() => parseBackup('{no es json')).toThrow('backup.error_invalid_json');
  });
  it('rechaza formato desconocido', () => {
    expect(() => parseBackup(JSON.stringify({ ...valid, format: 'otro' }))).toThrow('backup.error_invalid_format');
  });
  it('rechaza versión no soportada', () => {
    expect(() => parseBackup(JSON.stringify({ ...valid, version: 2 }))).toThrow('backup.error_unsupported_version');
  });
  it('rechaza si falta una colección', () => {
    const { expenses, ...missing } = valid;
    expect(() => parseBackup(JSON.stringify(missing))).toThrow('backup.error_invalid_format');
  });
});

describe('applyBackup — merge LWW (no clobber)', () => {
  it('un registro entrante MÁS NUEVO gana', () => {
    useExpenseStore.setState({ expenses: [expense('e1', 100, { description: 'viejo' })] });
    applyBackup({
      ...blank(), expenses: [expense('e1', 200, { description: 'nuevo' })],
    });
    const e = useExpenseStore.getState().expenses.find(x => x.id === 'e1')!;
    expect(e.updatedAt).toBe(200);
    expect(e.description).toBe('nuevo');
  });

  it('un registro entrante MÁS VIEJO NO pisa al local', () => {
    useExpenseStore.setState({ expenses: [expense('e1', 100, { description: 'local' })] });
    applyBackup({ ...blank(), expenses: [expense('e1', 50, { description: 'backup viejo' })] });
    const e = useExpenseStore.getState().expenses.find(x => x.id === 'e1')!;
    expect(e.updatedAt).toBe(100);
    expect(e.description).toBe('local');
  });

  it('registros nuevos se agregan; mergea entries personales también', () => {
    usePersonalStore.setState({ entries: [entry('pe1', 100)], budget: { ...emptyBudget } });
    applyBackup({ ...blank(), personalEntries: [entry('pe1', 200), entry('pe2', 10)] });
    const ids = usePersonalStore.getState().entries.map(e => e.id).sort();
    expect(ids).toEqual(['pe1', 'pe2']);
    expect(usePersonalStore.getState().entries.find(e => e.id === 'pe1')!.updatedAt).toBe(200);
  });

  it('restaura el budget solo si trae monto > 0', () => {
    usePersonalStore.setState({ entries: [], budget: { currency: 'ARS', monthlyAmount: 30000, includeOwedToMe: false } });
    // budget vacío en el backup → NO pisa el local
    applyBackup({ ...blank(), personalBudget: emptyBudget });
    expect(usePersonalStore.getState().budget.monthlyAmount).toBe(30000);
    // budget con monto → restaura
    applyBackup({ ...blank(), personalBudget: { currency: 'USD', monthlyAmount: 99000, includeOwedToMe: true } });
    expect(usePersonalStore.getState().budget.monthlyAmount).toBe(99000);
    expect(usePersonalStore.getState().budget.currency).toBe('USD');
  });
});

describe('round-trip export → import', () => {
  it('exportar y reimportar en stores vacíos reproduce los datos', () => {
    useGroupStore.setState({ groups: [group('g1', 10)] });
    useExpenseStore.setState({ expenses: [expense('e1', 10), expense('e2', 20)] });
    useUserStore.setState({ users: [user('u1', 10)] });
    usePersonalStore.setState({ entries: [entry('pe1', 10)], budget: { currency: 'ARS', monthlyAmount: 12345, includeOwedToMe: false } });

    const raw = serializeBackup(buildBackup());
    resetStores();
    importBackup(raw);

    expect(useGroupStore.getState().groups.map(g => g.id)).toEqual(['g1']);
    expect(useExpenseStore.getState().expenses.map(e => e.id).sort()).toEqual(['e1', 'e2']);
    expect(useUserStore.getState().users.map(u => u.id)).toEqual(['u1']);
    expect(usePersonalStore.getState().entries.map(e => e.id)).toEqual(['pe1']);
    expect(usePersonalStore.getState().budget.monthlyAmount).toBe(12345);
  });
});

describe('backupFileName', () => {
  it('genera nombre con fecha y extensión .splitp2p', () => {
    const name = backupFileName(new Date(2026, 6, 21).getTime()); // jul (mes 6) 2026
    expect(name).toBe('splitp2p-backup-2026-07-21.splitp2p');
  });
});

// helper: BackupFile vacío para completar los campos no bajo prueba
function blank(): BackupFile {
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: 0,
    groups: [], expenses: [], payments: [], users: [], personalEntries: [],
    personalBudget: emptyBudget,
  };
}
