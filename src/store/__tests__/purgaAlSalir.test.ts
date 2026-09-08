import { createSecureStorage } from '@/src/utils/secureStorage';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useRecurringStore } from '@/src/store/recurringStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { purgarGrupoLocalmente } from '@/src/services/salirDelGrupo';
import type { User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(),
  deviceId: () => 'dev',
  olvidarCursor: jest.fn(),
  publishNow: jest.fn(async () => {}),
}));

/**
 * **T-089 · La copia local se va al salir del grupo.**
 *
 * Es lo único que puede hacer cierto el «arranca desde 0»: el relay no puede
 * imponerlo, porque el que se fue conserva la clave del grupo y el topic — no
 * hay rotación de época.
 *
 * ⚠️ **Es la única excepción a la regla #1** («nunca DELETE físico, siempre
 * tombstone»), y no la contradice: la regla #1 gobierna **lo que se sincroniza**.
 * Un tombstone es un registro que VIAJA para que el otro también borre. Acá el
 * borrado es local y unilateral — nadie más se entera y nada sale del teléfono.
 * Hacerlo con tombstones les borraría los gastos a los que se quedaron, que es
 * exactamente el daño que T-074 §1 se niega a hacer. El test 5 lo fija.
 *
 * Confirmado contra Splitwise (P-16): **el grupo no olvida nada**; lo que se
 * limpia es sólo la copia del que se fue.
 */
const YO: User = { id: 'yo', name: 'Yo' } as User;
const meta = { updatedAt: 1, isDeleted: false };
const g = (id: string) => ({ id, name: id, memberIds: ['yo'], currency: 'ARS', createdAt: 0, createdById: 'yo', deletionVotes: [], ...meta }) as never;
const e = (id: string, groupId: string) => ({ id, groupId, description: id, amount: 1, currency: 'ARS', paidById: 'yo', splitMode: 'equal', splits: [], category: 'other', date: 0, createdAt: 0, createdById: 'yo', deletionVotes: [], ...meta }) as never;

beforeEach(() => {
  ['groups', 'expenses', 'payments', 'users', 'recurring', 'comments', 'groupkeys'].forEach(
    b => createSecureStorage(b as never).clearAll(),
  );
  useAuthStore.setState({ currentUser: YO });

  useGroupStore.setState({ groups: [g('G'), g('H')] });
  useExpenseStore.setState({ expenses: [e('eG', 'G'), e('eH', 'H')] });
  usePaymentStore.setState({ payments: [
    { id: 'pG', groupId: 'G', fromUserId: 'yo', toUserId: 'beto', amount: 1, currency: 'ARS', date: 0, createdAt: 0, createdById: 'yo', ...meta } as never,
    { id: 'pH', groupId: 'H', fromUserId: 'yo', toUserId: 'beto', amount: 1, currency: 'ARS', date: 0, createdAt: 0, createdById: 'yo', ...meta } as never,
  ]});
  useCommentStore.setState({ comments: [
    { id: 'cG', expenseId: 'eG', authorId: 'yo', text: 'del grupo G', createdAt: 0, ...meta } as never,
    { id: 'cH', expenseId: 'eH', authorId: 'yo', text: 'del grupo H', createdAt: 0, ...meta } as never,
  ]});
  useRecurringStore.setState({ recurring: [
    { id: 'rG', groupId: 'G', description: 'rG', amount: 1, currency: 'ARS', paidById: 'yo', splitMode: 'equal', memberIds: ['yo'], category: 'other', rule: { frequency: 'monthly', startDate: 0 }, lastMaterializedAt: null, isActive: true, createdAt: 0, createdById: 'yo', ...meta } as never,
    { id: 'rH', groupId: 'H', description: 'rH', amount: 1, currency: 'ARS', paidById: 'yo', splitMode: 'equal', memberIds: ['yo'], category: 'other', rule: { frequency: 'monthly', startDate: 0 }, lastMaterializedAt: null, isActive: true, createdAt: 0, createdById: 'yo', ...meta } as never,
  ]});
  useUserStore.setState({ users: [YO, { id: 'beto', name: 'Beto' } as User] });
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
  useGroupKeyStore.getState().ensureKey('H');
});

describe('lo que se va', () => {
  it('el grupo, sus gastos, pagos, comentarios y recurrentes', () => {
    purgarGrupoLocalmente('G');

    expect(useGroupStore.getState().groups.map(x => x.id)).toEqual(['H']);
    expect(useExpenseStore.getState().expenses.map(x => x.id)).toEqual(['eH']);
    expect(usePaymentStore.getState().payments.map(x => x.id)).toEqual(['pH']);
    expect(useCommentStore.getState().comments.map(x => x.id)).toEqual(['cH']);
    expect(useRecurringStore.getState().recurring.map(x => x.id)).toEqual(['rH']);
  });

  it('la clave del grupo, sin llevarse la de los otros', () => {
    // Sin la clave, este teléfono ya no puede abrir los sobres de ese grupo.
    purgarGrupoLocalmente('G');

    expect(useGroupKeyStore.getState().keys.map(k => k.groupId)).toEqual(['H']);
  });
});

describe('lo que NO se va', () => {
  it('los `User` de los demás siguen: pueden estar en otros grupos', () => {
    purgarGrupoLocalmente('G');

    expect(useUserStore.getState().users.map(u => u.id).sort()).toEqual(['beto', 'yo']);
  });

  it('nada de los otros grupos se toca', () => {
    // La mutación que esto cubre: perder el filtro por `groupId` y borrar todo.
    purgarGrupoLocalmente('G');

    expect(useGroupStore.getState().groups).toHaveLength(1);
    expect(useExpenseStore.getState().expenses).toHaveLength(1);
  });
});

describe('el borrado es LOCAL, no un tombstone que viaja', () => {
  it('no deja registros marcados `isDeleted`: los saca de verdad', () => {
    /**
     * La mutación que este test tumba: hacer la purga con `isDeleted: true` en
     * vez de un borrado local. Se vería igual en la pantalla **y publicaría el
     * borrado a los que se quedaron**, rompiéndoles las cuentas — el daño que
     * T-074 §1 se niega a hacer.
     */
    purgarGrupoLocalmente('G');

    const todos = [
      ...useExpenseStore.getState().expenses,
      ...usePaymentStore.getState().payments,
      ...useGroupStore.getState().groups,
    ];
    expect(todos.filter(x => x.isDeleted)).toEqual([]);
    expect(todos.map(x => x.id).sort()).toEqual(['H', 'eH', 'pH']);
  });

  it('lo purgado no vuelve al rehidratar: se fue del storage, no de la memoria', () => {
    purgarGrupoLocalmente('G');

    useExpenseStore.getState().hydrate();
    useGroupStore.getState().hydrate();

    expect(useExpenseStore.getState().expenses.map(x => x.id)).toEqual(['eH']);
    expect(useGroupStore.getState().groups.map(x => x.id)).toEqual(['H']);
  });
});
