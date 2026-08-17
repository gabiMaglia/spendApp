import { buildDelta, applyDelta, peerIsOutdated, DELTA_FEATURE_VERSION } from '../useSyncQR';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useRecurringStore } from '@/src/store/recurringStore';
import { useCommentStore } from '@/src/store/commentStore';
import type { User } from '@/src/types/models';

/**
 * "Nada se pierde": TODO lo que el usuario crea en un teléfono tiene que llegar
 * al otro después de sincronizar.
 *
 * El test recorre las entidades una por una en vez de mirar sólo las que uno
 * recuerda. Un store que exista pero no viaje en el delta es la peor clase de
 * bug: no falla nada, no avisa nada — los datos simplemente nunca llegan.
 * (Pasó de verdad con `personal`: se hidrataba por cuenta, se exportaba al
 * backup y se declaraba fusionable, pero `buildDelta` no lo mandaba.)
 */

const ME = 'ua';
const PEER = 'ub';

const meta = (id: string) => ({ id, updatedAt: 1_000, isDeleted: false });

/** Cada entidad: cómo sembrarla en el emisor y cómo leerla en el receptor. */
const ENTITIES = [
  {
    name: 'grupos',
    seed: () => useGroupStore.setState({ groups: [{ ...meta('g1'), name: 'Viaje', memberIds: [ME], currency: 'ARS', createdAt: 0, createdById: ME } as any] }),
    read: () => useGroupStore.getState().groups.map(x => x.id),
  },
  {
    name: 'gastos',
    seed: () => useExpenseStore.setState({ expenses: [{ ...meta('e1'), groupId: 'g1', description: 'Cena', amount: 100, currency: 'ARS', paidById: ME, splits: [], splitMode: 'equal', category: 'food', date: 0, createdAt: 0, createdById: ME, deletionVotes: [] } as any] }),
    read: () => useExpenseStore.getState().expenses.map(x => x.id),
  },
  {
    name: 'pagos',
    seed: () => usePaymentStore.setState({ payments: [{ ...meta('p1'), groupId: 'g1', fromUserId: ME, toUserId: PEER, amount: 50, currency: 'ARS', date: 0, createdAt: 0 } as any] }),
    read: () => usePaymentStore.getState().payments.map(x => x.id),
  },
  {
    name: 'usuarios',
    seed: () => useUserStore.setState({ users: [{ ...meta('uz'), name: 'Zoe', email: 'z@x.com', authProvider: 'google', createdAt: 0 } as any] }),
    read: () => useUserStore.getState().users.map(x => x.id),
  },
  {
    name: 'movimientos personales',
    seed: () => usePersonalStore.setState({ entries: [{ ...meta('pe1'), kind: 'expense', description: 'Café', amount: 500, currency: 'ARS', category: 'food', date: 0, createdAt: 0 } as any] }),
    read: () => usePersonalStore.getState().entries.map(x => x.id),
  },
  {
    name: 'plantillas recurrentes',
    seed: () => useRecurringStore.setState({ recurring: [{ ...meta('r1'), groupId: 'g1', description: 'Alquiler', amount: 1000, currency: 'ARS', paidById: ME, splitMode: 'equal', memberIds: [ME], category: 'home', rule: { frequency: 'monthly', startDate: 0 }, lastMaterializedAt: null, isActive: true, createdAt: 0, createdById: ME } as any] }),
    read: () => useRecurringStore.getState().recurring.map(x => x.id),
  },
  {
    name: 'comentarios',
    seed: () => useCommentStore.setState({ comments: [{ ...meta('c1'), expenseId: 'e1', authorId: ME, text: 'hola', createdAt: 0 } as any] }),
    read: () => useCommentStore.getState().comments.map(x => x.id),
  },
] as const;

function clearAll() {
  useGroupStore.setState({ groups: [] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  useUserStore.setState({ users: [] });
  usePersonalStore.setState({ entries: [] });
  useRecurringStore.setState({ recurring: [] });
  useCommentStore.setState({ comments: [] });
}

describe('delta de sync — nada se pierde entre dos teléfonos', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUser: { id: ME } as User });
    clearAll();
  });

  ENTITIES.forEach(entity => {
    it(`${entity.name}: viajan del emisor al receptor`, () => {
      entity.seed();
      const delta = buildDelta(ME);

      clearAll(); // ahora somos el otro teléfono, vacío
      applyDelta(delta, PEER);

      expect(entity.read()).toHaveLength(1);
    });
  });

  it('un round-trip completo trae TODAS las entidades de una', () => {
    ENTITIES.forEach(e => e.seed());
    const delta = buildDelta(ME);

    clearAll();
    applyDelta(delta, PEER);

    const vacias = ENTITIES.filter(e => e.read().length === 0).map(e => e.name);
    expect(vacias).toEqual([]);
  });

  it('sincronizar dos veces no duplica nada', () => {
    ENTITIES.forEach(e => e.seed());
    const delta = buildDelta(ME);

    clearAll();
    applyDelta(delta, PEER);
    applyDelta(delta, PEER);

    ENTITIES.forEach(e => expect(e.read()).toHaveLength(1));
  });

  // Compatibilidad: un peer que no actualizó manda un delta sin los campos nuevos.
  it('un delta viejo (sin las entidades nuevas) no rompe ni borra lo local', () => {
    ENTITIES.forEach(e => e.seed());
    const delta = buildDelta(ME);
    delete (delta as any).recurring;
    delete (delta as any).comments;
    delete (delta as any).personal;

    expect(() => applyDelta(delta, PEER)).not.toThrow();
    expect(useRecurringStore.getState().recurring).toHaveLength(1);
    expect(useCommentStore.getState().comments).toHaveLength(1);
    expect(usePersonalStore.getState().entries).toHaveLength(1);
  });
});

describe('peerIsOutdated — detectar un dispositivo sin actualizar', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUser: { id: ME } as User });
    clearAll();
  });

  it('un delta nuestro NO se marca como desactualizado', () => {
    expect(peerIsOutdated(buildDelta(ME))).toBe(false);
  });

  it('buildDelta declara la versión de features', () => {
    expect(buildDelta(ME).featureVersion).toBe(DELTA_FEATURE_VERSION);
  });

  // Un peer anterior a los gastos con varios pagadores no manda este campo.
  it('un delta SIN featureVersion se detecta como desactualizado', () => {
    const delta = buildDelta(ME);
    delete (delta as any).featureVersion;

    expect(peerIsOutdated(delta)).toBe(true);
  });

  it('una versión de features menor también cuenta como desactualizado', () => {
    expect(peerIsOutdated({ ...buildDelta(ME), featureVersion: DELTA_FEATURE_VERSION - 1 })).toBe(true);
  });

  it('una versión MAYOR no se marca (el otro está más nuevo, no nosotros)', () => {
    expect(peerIsOutdated({ ...buildDelta(ME), featureVersion: DELTA_FEATURE_VERSION + 1 })).toBe(false);
  });
});
