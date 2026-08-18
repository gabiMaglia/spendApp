import { buildGroupPayload } from '../relaySync';
import { buildDelta, applyDelta } from '../useSyncQR';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useRecurringStore } from '@/src/store/recurringStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

/**
 * **El sobre de un grupo lleva SÓLO lo de ese grupo.**
 *
 * Antes llevaba el dispositivo entero cifrado con la clave de UN grupo:
 * cualquiera de sus miembros lo abría y se quedaba con los otros grupos, sus
 * gastos y los movimientos personales de quien publicaba. Con dos cuentas del
 * mismo dueño era invisible. Con gente real es una filtración — y no se puede
 * deshacer, porque el dato ya está en el teléfono del otro.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

const YO = 'ana';
const meta = { updatedAt: 1_000, isDeleted: false };

/** Dos grupos: G (al que publico) y H (privado, del que el otro no es parte). */
function sembrar() {
  useAuthStore.setState({ currentUser: { id: YO, name: 'Ana' } as User });

  useGroupStore.setState({ groups: [
    { id: 'G', name: 'Asado', memberIds: [YO, 'beto'], currency: 'ARS',
      createdAt: 0, createdById: YO, deletionVotes: [], ...meta } as any,
    { id: 'H', name: 'Terapia de pareja', memberIds: [YO, 'pareja'], currency: 'ARS',
      createdAt: 0, createdById: YO, deletionVotes: [], ...meta } as any,
  ]});

  useExpenseStore.setState({ expenses: [
    { id: 'eG', groupId: 'G', description: 'Carne', amount: 20_000, currency: 'ARS',
      paidById: YO, splitMode: 'equal', splits: [], category: 'food', date: 0,
      createdAt: 0, createdById: YO, deletionVotes: [], ...meta } as any,
    { id: 'eH', groupId: 'H', description: 'Sesion de enero', amount: 90_000, currency: 'ARS',
      paidById: YO, splitMode: 'equal', splits: [], category: 'health', date: 0,
      createdAt: 0, createdById: YO, deletionVotes: [], ...meta } as any,
  ]});

  usePaymentStore.setState({ payments: [
    { id: 'pG', groupId: 'G', fromUserId: 'beto', toUserId: YO, amount: 500,
      currency: 'ARS', date: 0, createdAt: 0, createdById: YO, ...meta } as any,
    { id: 'pH', groupId: 'H', fromUserId: 'pareja', toUserId: YO, amount: 900,
      currency: 'ARS', date: 0, createdAt: 0, createdById: YO, ...meta } as any,
  ]});

  useCommentStore.setState({ comments: [
    { id: 'cG', expenseId: 'eG', authorId: YO, text: 'Riquisimo', createdAt: 0, ...meta } as any,
    { id: 'cH', expenseId: 'eH', authorId: YO, text: 'Cuesta caro', createdAt: 0, ...meta } as any,
  ]});

  useRecurringStore.setState({ recurring: [
    { id: 'rG', groupId: 'G', description: 'Parrilla mensual', amount: 100, currency: 'ARS',
      paidById: YO, splitMode: 'equal', memberIds: [YO], category: 'food',
      rule: { frequency: 'monthly', startDate: 0 }, lastMaterializedAt: null,
      isActive: true, createdAt: 0, createdById: YO, ...meta } as any,
    { id: 'rH', groupId: 'H', description: 'Sesion semanal', amount: 900, currency: 'ARS',
      paidById: YO, splitMode: 'equal', memberIds: [YO], category: 'health',
      rule: { frequency: 'weekly', startDate: 0 }, lastMaterializedAt: null,
      isActive: true, createdAt: 0, createdById: YO, ...meta } as any,
  ]});

  usePersonalStore.setState({ entries: [
    { id: 'x1', description: 'Sueldo', amount: 1_500_000, currency: 'ARS',
      date: 0, kind: 'income', category: 'salary', createdAt: 0, ...meta } as any,
  ]});

  useUserStore.setState({ users: [
    { id: YO, name: 'Ana' } as User,
    { id: 'beto', name: 'Beto' } as User,
    { id: 'pareja', name: 'Mi pareja' } as User,
  ]});
}

beforeEach(() => {
  createSecureStorage('groupkeys').clearAll();
  useGroupKeyStore.setState({ keys: [] });
  sembrar();
});

describe('el sobre de un grupo no filtra nada ajeno', () => {
  const serializado = () => JSON.stringify(buildGroupPayload('G', YO));

  it('NO lleva los otros grupos', () => {
    expect(serializado()).not.toContain('Terapia de pareja');
  });

  it('NO lleva los gastos de otros grupos', () => {
    expect(serializado()).not.toContain('Sesion de enero');
  });

  it('NO lleva los pagos de otros grupos', () => {
    expect(buildGroupPayload('G', YO).payments.map(p => p.id)).toEqual(['pG']);
  });

  it('NO lleva los comentarios de otros grupos', () => {
    expect(serializado()).not.toContain('Cuesta caro');
  });

  it('NO lleva las plantillas recurrentes de otros grupos', () => {
    expect(serializado()).not.toContain('Sesion semanal');
  });

  // Los movimientos personales no tienen grupo: no le corresponden a nadie más.
  it('NO lleva los movimientos personales', () => {
    expect(serializado()).not.toContain('Sueldo');
    expect(buildGroupPayload('G', YO).personal).toBeUndefined();
  });

  it('NO lleva los perfiles de gente ajena al grupo', () => {
    expect(serializado()).not.toContain('Mi pareja');
  });

  // Si el relay pudiera entregar claves podría sustituirlas y leer todo.
  it('NO lleva las claves de grupo', () => {
    const record = useGroupKeyStore.getState().ensureKey('G');
    expect(serializado()).not.toContain(record.key);
  });
});

describe('pero sí lleva todo lo del grupo', () => {
  it('el grupo, su gasto, su pago, su comentario y su plantilla', () => {
    const p = buildGroupPayload('G', YO);

    expect(p.groups.map(g => g.id)).toEqual(['G']);
    expect(p.expenses.map(e => e.id)).toEqual(['eG']);
    expect(p.payments.map(x => x.id)).toEqual(['pG']);
    expect(p.comments!.map(x => x.id)).toEqual(['cG']);
    expect(p.recurring!.map(x => x.id)).toEqual(['rG']);
  });

  // Sin los perfiles, el otro ve ids en vez de nombres.
  it('los perfiles de los miembros', () => {
    expect(buildGroupPayload('G', YO).users.map(u => u.id).sort()).toEqual(['ana', 'beto']);
  });

  it('el receptor lo aplica sin perder lo suyo', () => {
    const payload = buildGroupPayload('G', YO);

    // El receptor arranca con SUS propios datos de otro grupo.
    useGroupStore.setState({ groups: [] });
    useExpenseStore.setState({ expenses: [
      { id: 'suyo', groupId: 'Z', description: 'Propio', amount: 1, currency: 'ARS',
        paidById: 'beto', splitMode: 'equal', splits: [], category: 'other', date: 0,
        createdAt: 0, createdById: 'beto', deletionVotes: [], ...meta } as any,
    ]});

    applyDelta(payload, 'beto');

    const ids = useExpenseStore.getState().expenses.map(e => e.id).sort();
    expect(ids).toEqual(['eG', 'suyo']);
  });
});

/**
 * Este objeto se arma campo por campo, así que una entidad NUEVA en el delta no
 * viajaría por el relay y nadie se enteraría (fue exactamente el bug de
 * `personal`). Acá se comparan las claves del delta completo contra la lista de
 * las que alguien ya clasificó: si aparece una nueva, este test falla y obliga
 * a decidir si va en el sobre del grupo o no.
 */
describe('nada se agrega al delta sin decidir si viaja', () => {
  const CLASIFICADAS = [
    'version', 'featureVersion', 'fromUserId', 'timestamp',  // metadatos
    'groups', 'expenses', 'payments', 'users', 'recurring', 'comments', // van
    'personal', 'groupKeys',                                 // NO van, a propósito
  ];

  it('todas las claves del delta están clasificadas', () => {
    const sinClasificar = Object.keys(buildDelta(YO)).filter(k => !CLASIFICADAS.includes(k));
    expect(sinClasificar).toEqual([]);
  });
});
