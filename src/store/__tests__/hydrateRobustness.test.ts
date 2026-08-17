import { useGroupStore } from '../groupStore';
import { useExpenseStore } from '../expenseStore';
import { usePaymentStore } from '../paymentStore';
import { useUserStore } from '../userStore';
import { usePersonalStore } from '../personalStore';
import { useRecurringStore } from '../recurringStore';
import { useCommentStore } from '../commentStore';
import { useAuthStore } from '../authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

/**
 * Un dato corrupto en storage no puede tirar en `hydrate`.
 *
 * `hydrate` corre en el arranque (`app/_layout.tsx`) dentro de un IIFE: si
 * lanza, `isLoading` queda en `true` para siempre y la app se traba en la
 * pantalla de carga, sin forma de salir ni de limpiar el dato. Ya pasó de verdad
 * con la sesión (T-020) y 5 stores habían quedado sin la misma protección.
 *
 * El test enumera TODOS los stores en vez de probar dos: así un store nuevo que
 * nazca sin el guard se cae acá y no en el teléfono de alguien.
 */

const UID = 'ua';

const STORES = [
  { name: 'groups',    bucket: 'groups',    key: 'data_v1',    hydrate: () => useGroupStore.getState().hydrate(),     read: () => useGroupStore.getState().groups },
  { name: 'expenses',  bucket: 'expenses',  key: 'data_v1',    hydrate: () => useExpenseStore.getState().hydrate(),   read: () => useExpenseStore.getState().expenses },
  { name: 'payments',  bucket: 'payments',  key: 'data_v1',    hydrate: () => usePaymentStore.getState().hydrate(),   read: () => usePaymentStore.getState().payments },
  { name: 'users',     bucket: 'users',     key: 'data_v1',    hydrate: () => useUserStore.getState().hydrate(),      read: () => useUserStore.getState().users },
  { name: 'personal',  bucket: 'personal',  key: 'entries_v1', hydrate: () => usePersonalStore.getState().hydrate(),  read: () => usePersonalStore.getState().entries },
  { name: 'recurring', bucket: 'recurring', key: 'data_v1',    hydrate: () => useRecurringStore.getState().hydrate(), read: () => useRecurringStore.getState().recurring },
  { name: 'comments',  bucket: 'comments',  key: 'data_v1',    hydrate: () => useCommentStore.getState().hydrate(),   read: () => useCommentStore.getState().comments },
] as const;

describe('hydrate — un storage corrupto no traba la app', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUser: { id: UID } as User, isLoading: false });
  });

  STORES.forEach(store => {
    it(`${store.name}: JSON roto ⇒ arranca vacío en vez de tirar`, () => {
      const st = createSecureStorage(store.bucket as any);
      st.clearAll();
      st.set(`${store.key}::u:${UID}`, '{esto no es json');

      expect(() => store.hydrate()).not.toThrow();
      expect(store.read()).toEqual([]);
    });
  });

  it('ningún store queda con isLoading en true tras un dato corrupto', () => {
    STORES.forEach(store => {
      const st = createSecureStorage(store.bucket as any);
      st.clearAll();
      st.set(`${store.key}::u:${UID}`, 'basura');
      store.hydrate();
    });

    const cargando = [
      ['groups', useGroupStore.getState().isLoading],
      ['expenses', useExpenseStore.getState().isLoading],
      ['payments', usePaymentStore.getState().isLoading],
      ['recurring', useRecurringStore.getState().isLoading],
      ['comments', useCommentStore.getState().isLoading],
    ].filter(([, loading]) => loading === true).map(([name]) => name);

    expect(cargando).toEqual([]);
  });

  it('el presupuesto personal corrupto cae al default', () => {
    const st = createSecureStorage('personal');
    st.clearAll();
    st.set(`budget_v1::u:${UID}`, '{roto');

    expect(() => usePersonalStore.getState().hydrate()).not.toThrow();
    expect(usePersonalStore.getState().budget).toBeDefined();
  });
});
