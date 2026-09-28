import { applyDelta } from '../applyDelta';
import { armarComoDelta } from '@/src/test-utils/armarComoDelta';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
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
 * backup y se declaraba fusionable, pero el delta no lo mandaba — ver abajo
 * por qué esa fila salió de esta lista.)
 *
 * T-206-A (D1/D2): antes se armaba con `buildDelta` (el delta completo del
 * pairing QR, `useSyncQR.ts`, borrado en T-193). El único camino real que
 * queda es el relay, scopeado por grupo (`adaptador.armar`) — de ahí que
 * todo abajo cuelgue de un único grupo `g1` del que `ME` y `uz` son miembros.
 * `personal` sale de la lista de entidades: nunca viajó por el relay (D1,
 * `acotarDeltaAlGrupo.ts` lo vaciaba siempre) y ahora ni siquiera es un campo
 * de `SyncDelta` — no hay delta que pueda "perderlo" porque no hay delta que
 * pueda tenerlo.
 */

const ME = 'ua';
const PEER = 'ub';

const meta = (id: string) => ({ id, updatedAt: 1_000, isDeleted: false });

/** Cada entidad: cómo sembrarla en el emisor y cómo leerla en el receptor. */
const ENTITIES = [
  {
    name: 'grupos',
    seed: () => useGroupStore.setState({ groups: [{ ...meta('g1'), name: 'Viaje', memberIds: [ME, 'uz'], currency: 'ARS', createdAt: 0, createdById: ME } as any] }),
    read: () => useGroupStore.getState().groups.map(x => x.id),
  },
  {
    name: 'gastos',
    seed: () => useExpenseStore.setState({ expenses: [{ ...meta('e1'), groupId: 'g1', description: 'Cena', amount: 100, currency: 'ARS', paidById: ME, splits: [], splitMode: 'equal', category: 'food', date: 0, createdAt: 0, createdById: ME, } as any] }),
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
      // `grupos` ya sembró `g1` con [ME, 'uz'] como miembros — necesario para
      // que `armar` incluya al resto de las entidades (filtra por groupId
      // y, para `users`, por membresía de ESE grupo).
      if (entity.name !== 'grupos') {
        useGroupStore.setState({ groups: [{ ...meta('g1'), name: 'Viaje', memberIds: [ME, 'uz'], currency: 'ARS', createdAt: 0, createdById: ME } as any] });
      }
      // `armar` sólo deja pasar un comentario si su gasto ya es local de
      // este grupo (igual que el receptor real, `acotarDeltaAlGrupo`): sin
      // esto la fila `comentarios` no prueba nada propio, prueba que faltó
      // el gasto.
      if (entity.name === 'comentarios') {
        useExpenseStore.setState({ expenses: [{ ...meta('e1'), groupId: 'g1', description: 'Cena', amount: 100, currency: 'ARS', paidById: ME, splits: [], splitMode: 'equal', category: 'food', date: 0, createdAt: 0, createdById: ME } as any] });
      }
      const delta = armarComoDelta('g1', ME);

      clearAll(); // ahora somos el otro teléfono, vacío
      applyDelta(delta, PEER);

      expect(entity.read()).toHaveLength(1);
    });
  });

  it('un round-trip completo trae TODAS las entidades de una', () => {
    ENTITIES.forEach(e => e.seed());
    const delta = armarComoDelta('g1', ME);

    clearAll();
    applyDelta(delta, PEER);

    const vacias = ENTITIES.filter(e => e.read().length === 0).map(e => e.name);
    expect(vacias).toEqual([]);
  });

  it('sincronizar dos veces no duplica nada', () => {
    ENTITIES.forEach(e => e.seed());
    const delta = armarComoDelta('g1', ME);

    clearAll();
    applyDelta(delta, PEER);
    applyDelta(delta, PEER);

    ENTITIES.forEach(e => expect(e.read()).toHaveLength(1));
  });

  // Compatibilidad: un peer que no actualizó manda un delta sin los campos nuevos.
  it('un delta viejo (sin las entidades nuevas) no rompe ni borra lo local', () => {
    ENTITIES.forEach(e => e.seed());
    const delta = armarComoDelta('g1', ME);
    delete (delta as any).recurring;
    delete (delta as any).comments;

    expect(() => applyDelta(delta, PEER)).not.toThrow();
    expect(useRecurringStore.getState().recurring).toHaveLength(1);
    expect(useCommentStore.getState().comments).toHaveLength(1);
  });
});
