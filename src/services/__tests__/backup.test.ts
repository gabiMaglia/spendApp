import {
  buildBackup, serializeBackup, parseBackup, applyBackup, importBackup,
  backupFileName, BACKUP_FORMAT, BACKUP_VERSION, type BackupFile,
} from '../backup';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useAuthStore } from '@/src/store/authStore';
import { useRecurringStore } from '@/src/store/recurringStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useGroupKeyStore, type GroupKeyRecord } from '@/src/store/groupKeyStore';
import { rosterDe } from '@/src/algorithms/roster';
import { recargarAlias } from '@/src/store/identityAlias';
import { deriveTopic, fromHex } from '@/src/sync/envelopeCrypto';
import type {
  Group, Expense, Payment, User, PersonalEntry, PersonalBudget,
} from '@/src/types/models';

jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(),
  anunciarMiTarjeta: jest.fn(),
}));

// ── Factories mínimas pero completas (TS estricto) ──────────────────────────
function group(id: string, updatedAt: number, over: Partial<Group> = {}): Group {
  return {
    id, updatedAt, isDeleted: false, name: `G-${id}`, memberIds: ['u1'],
    miembros: {}, // T-182: placeholder de tipo (fixture no ejercita el roster)
    currency: 'ARS', createdAt: 0, createdById: 'u1', ...over,
  };
}
function expense(id: string, updatedAt: number, over: Partial<Expense> = {}): Expense {
  return {
    id, updatedAt, isDeleted: false, groupId: 'g1', description: `E-${id}`,
    amount: 1000, currency: 'ARS', paidById: 'u1',
    splits: [{ userId: 'u1', amount: 1000, isPaid: false }],
    splitMode: 'equal', category: 'other', date: 0, createdAt: 0,
    createdById: 'u1', ...over,
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

function miembros(...ids: string[]): Group['miembros'] {
  return Object.fromEntries(ids.map((id, i) => [id, { estado: 'in' as const, at: i }]));
}

function resetStores() {
  useGroupStore.setState({ groups: [] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  useUserStore.setState({ users: [] });
  usePersonalStore.setState({ entries: [], budget: { ...emptyBudget } });
  useAuthStore.setState({ currentUser: null });
  useGroupKeyStore.setState({ keys: [] });
  recargarAlias();
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
    // T-188b subió BACKUP_VERSION a 2 y sigue aceptando 1 (v1 sin claves) — acá
    // lo que hay que probar es una versión que NINGUNA de las dos rutas conoce.
    expect(() => parseBackup(JSON.stringify({ ...valid, version: 99 }))).toThrow('backup.error_unsupported_version');
  });
  it('acepta v1, sin `ownerId` ni `groupKeys` (backups de antes de T-188b)', () => {
    expect(parseBackup(JSON.stringify({ ...valid, version: 1 })).version).toBe(1);
  });
  it('rechaza si falta una colección', () => {
    const { expenses, ...missing } = valid;
    expect(() => parseBackup(JSON.stringify(missing))).toThrow('backup.error_invalid_format');
  });
});

describe('applyBackup — RESTORE (reemplazo, decisión PO)', () => {
  it('REEMPLAZA el estado: descarta lo local que no está en el backup', () => {
    useExpenseStore.setState({ expenses: [expense('e1', 100), expense('eLocal', 999)] });
    applyBackup({ ...blank(), expenses: [expense('e1', 100)] });
    const ids = useExpenseStore.getState().expenses.map(e => e.id);
    expect(ids).toEqual(['e1']); // eLocal desapareció (no estaba en el backup)
  });

  it('reemplaza aunque el registro del backup sea MÁS VIEJO (no es LWW)', () => {
    useExpenseStore.setState({ expenses: [expense('e1', 100, { description: 'local nuevo' })] });
    applyBackup({ ...blank(), expenses: [expense('e1', 50, { description: 'del backup' })] });
    const e = useExpenseStore.getState().expenses.find(x => x.id === 'e1')!;
    expect(e.description).toBe('del backup');
    expect(e.updatedAt).toBe(50);
  });

  it('reemplaza entries personales y SIEMPRE restaura el budget (incluso vacío)', () => {
    usePersonalStore.setState({
      entries: [entry('viejo', 100)],
      budget: { currency: 'ARS', monthlyAmount: 30000, includeOwedToMe: false },
    });
    applyBackup({ ...blank(), personalEntries: [entry('pe2', 10)], personalBudget: emptyBudget });
    expect(usePersonalStore.getState().entries.map(e => e.id)).toEqual(['pe2']);
    expect(usePersonalStore.getState().budget.monthlyAmount).toBe(0); // restaurado (vacío)
  });

  it('refresca el nombre del usuario de sesión (authStore) desde el backup', () => {
    useAuthStore.setState({ currentUser: user('u1', 100, { name: 'Nombre viejo' }) });
    applyBackup({ ...blank(), users: [user('u1', 200, { name: 'Nombre del backup' })] });
    expect(useAuthStore.getState().currentUser?.name).toBe('Nombre del backup');
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
  it('genera nombre con fecha y extensión .hushsplit', () => {
    const name = backupFileName(new Date(2026, 6, 21).getTime()); // jul (mes 6) 2026
    expect(name).toBe('hushsplit-backup-2026-07-21.hushsplit');
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

describe('backup — plantillas recurrentes y comentarios (hallazgo del verificador)', () => {
  const recurring = [{
    id: 'r1', groupId: 'g1', description: 'Alquiler', amount: 1000, currency: 'ARS' as const,
    paidById: 'ua', splitMode: 'equal' as const, memberIds: ['ua'], category: 'home' as const,
    miembros: {}, // T-182: placeholder de tipo (fixture no ejercita el roster)
    rule: { frequency: 'monthly' as const, startDate: 0 }, lastMaterializedAt: null,
    isActive: true, createdAt: 0, createdById: 'ua', updatedAt: 1_000, isDeleted: false,
  }];
  const comments = [{
    id: 'c1', expenseId: 'e1', authorId: 'ua', text: 'hola',
    createdAt: 0, updatedAt: 1_000, isDeleted: false,
  }];

  beforeEach(() => {
    useRecurringStore.setState({ recurring: [] });
    useCommentStore.setState({ comments: [] });
  });

  it('el export las incluye', () => {
    useRecurringStore.setState({ recurring: recurring as any });
    useCommentStore.setState({ comments: comments as any });

    const backup = buildBackup();

    expect(backup.recurring).toHaveLength(1);
    expect(backup.comments).toHaveLength(1);
  });

  it('sobreviven un round-trip completo export → import', () => {
    useRecurringStore.setState({ recurring: recurring as any });
    useCommentStore.setState({ comments: comments as any });
    const raw = serializeBackup(buildBackup());

    useRecurringStore.setState({ recurring: [] });
    useCommentStore.setState({ comments: [] });
    importBackup(raw);

    expect(useRecurringStore.getState().recurring).toHaveLength(1);
    expect(useCommentStore.getState().comments).toHaveLength(1);
  });

  it('un backup viejo (sin esos campos) no rompe el restore', () => {
    const backup = buildBackup();
    delete (backup as any).recurring;
    delete (backup as any).comments;

    expect(() => applyBackup(backup)).not.toThrow();
  });
});

describe('T-188b · el backup restaura la sesión completa (claves + roster)', () => {
  const CLAVE_G1: GroupKeyRecord = { groupId: 'g1', key: 'aa'.repeat(32), epoch: 1 };

  beforeEach(() => {
    (jest.requireMock('@/src/sync/relayEngine') as { schedulePublish: jest.Mock }).schedulePublish.mockClear();
  });

  it('B1 · exportar: el archivo lleva groupKeys y ownerId = mi id', () => {
    useAuthStore.setState({ currentUser: user('u1', 10) });
    useGroupKeyStore.setState({ keys: [CLAVE_G1] });

    const b = buildBackup();

    expect(b.ownerId).toBe('u1');
    expect(b.groupKeys).toEqual([CLAVE_G1]);
    // T-213 subió BACKUP_VERSION a 3 (archived/settings/contacts/aliases);
    // acá sólo importa que sea LA versión vigente, no el número puntual.
    expect(b.version).toBe(BACKUP_VERSION);
  });

  it('B2 · teléfono nuevo, mismo id (idEstable), importo mi backup: claves adoptadas, roster me incluye, se publica, la clave sirve para drenar (deriveTopic real)', async () => {
    // "Teléfono nuevo": sesión con mi id activa, pero SIN la clave del grupo
    // todavía (groupKeyStore vacío) y sin ser miembro local del grupo.
    useAuthStore.setState({ currentUser: user('u1', 10) });

    const backup: BackupFile = {
      ...blank(),
      ownerId: 'u1',
      groups: [group('g1', 10, { miembros: miembros('u2'), memberIds: ['u2'] })],
      expenses: [expense('e1', 10)],
      groupKeys: [CLAVE_G1],
    };

    applyBackup(backup);

    // claves adoptadas
    expect(useGroupKeyStore.getState().getKey('g1')).toEqual(CLAVE_G1);

    // roster me incluye (re-entrada por restauración)
    const g = useGroupStore.getState().getById('g1')!;
    expect(rosterDe(g.miembros)).toContain('u1');

    // se publica el grupo al que reingresé
    const { schedulePublish } = jest.requireMock('@/src/sync/relayEngine') as { schedulePublish: jest.Mock };
    expect(schedulePublish).toHaveBeenCalledWith('g1', expect.anything());

    // la clave restaurada sirve DE VERDAD para derivar el topic del relay
    const stored = useGroupKeyStore.getState().getKey('g1')!;
    const topic = await deriveTopic(fromHex(stored.key), stored.epoch);
    expect(typeof topic).toBe('string');
    expect(topic.length).toBeGreaterThan(0);
  });

  it('B3 · borré la cuenta (salí de los grupos saldados) y la recreé e importo el backup: vuelvo a estar "in" con el mismo id, con un `at` FRESCO (no el viejo del archivo)', () => {
    useAuthStore.setState({ currentUser: user('u1', 10) });
    // El backup NO me trae como miembro (mismo caso que B2): lo que importa acá
    // es que la re-entrada gane sobre un `out` reciente de T-187 cuando esto se
    // publique — y para eso el `at` tiene que ser NUEVO, no el que traía el
    // archivo. Un backup viejo con un `at` de hace meses perdería el merge
    // contra el `conBaja` que el borrado publicó.
    const backup: BackupFile = {
      ...blank(),
      ownerId: 'u1',
      groups: [group('g1', 10, { miembros: miembros('u2'), memberIds: ['u2'] })],
      groupKeys: [CLAVE_G1],
    };

    const antes = Date.now();
    applyBackup(backup);

    const g = useGroupStore.getState().getById('g1')!;
    expect(rosterDe(g.miembros)).toEqual(expect.arrayContaining(['u1', 'u2']));
    expect(g.miembros['u1']!.estado).toBe('in');
    expect(g.miembros['u1']!.at).toBeGreaterThanOrEqual(antes);
  });

  it('B4 · backup ajeno (confirmado): los datos se importan, las claves NO se adoptan, ningún conAlta', () => {
    // Confirmado = el usuario ya vio el aviso de que no es su backup y decidió
    // igual importarlo; `applyBackup` no pregunta, sólo decide por ownerId.
    useAuthStore.setState({ currentUser: user('u1', 10) });

    const backup: BackupFile = {
      ...blank(),
      ownerId: 'otra-persona',
      groups: [group('g1', 10, { miembros: miembros('otra-persona'), memberIds: ['otra-persona'] })],
      groupKeys: [CLAVE_G1],
    };

    applyBackup(backup);

    // datos importados (RESTORE de siempre)
    expect(useGroupStore.getState().getById('g1')).toBeDefined();
    // claves NO adoptadas
    expect(useGroupKeyStore.getState().getKey('g1')).toBeUndefined();
    // sin conAlta: mi id no aparece en un roster que nunca lo tuvo
    const g = useGroupStore.getState().getById('g1')!;
    expect(rosterDe(g.miembros)).not.toContain('u1');

    const { schedulePublish } = jest.requireMock('@/src/sync/relayEngine') as { schedulePublish: jest.Mock };
    expect(schedulePublish).not.toHaveBeenCalled();
  });

  it('B5 · backup v1 (sin groupKeys): se importa igual, sin claves, sin re-alta', () => {
    useAuthStore.setState({ currentUser: user('u1', 10) });

    const v1: BackupFile = {
      ...blank(), version: 1 as any, ownerId: 'u1',
      groups: [group('g1', 10, { miembros: miembros('u2'), memberIds: ['u2'] })],
    };
    delete (v1 as any).groupKeys;

    expect(() => applyBackup(v1)).not.toThrow();
    expect(useGroupKeyStore.getState().getKey('g1')).toBeUndefined();
    const g = useGroupStore.getState().getById('g1')!;
    expect(rosterDe(g.miembros)).not.toContain('u1'); // sin claves no hay re-entrada posible
  });

  it('parseBackup acepta un archivo v1 (formato viejo, sin groupKeys ni ownerId)', () => {
    const v1 = {
      format: BACKUP_FORMAT, version: 1, exportedAt: 0,
      groups: [], expenses: [], payments: [], users: [], personalEntries: [],
      personalBudget: emptyBudget,
    };
    expect(() => parseBackup(JSON.stringify(v1))).not.toThrow();
  });

  it('B6 · adoptKeys no pisa una clave local con época mayor (comportamiento actual de adoptKeys)', () => {
    useAuthStore.setState({ currentUser: user('u1', 10) });
    const claveLocalMasNueva: GroupKeyRecord = { groupId: 'g1', key: 'bb'.repeat(32), epoch: 5 };
    useGroupKeyStore.setState({ keys: [claveLocalMasNueva] });

    applyBackup({
      ...blank(), ownerId: 'u1',
      groups: [group('g1', 10, { miembros: miembros('u1'), memberIds: ['u1'] })],
      groupKeys: [CLAVE_G1], // epoch 1, menor
    });

    expect(useGroupKeyStore.getState().getKey('g1')).toEqual(claveLocalMasNueva);
  });
});
