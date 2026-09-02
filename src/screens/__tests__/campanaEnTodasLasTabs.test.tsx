import React from 'react';
import { render } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';
import { act } from '@testing-library/react-native';
import type { User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  useFocusEffect: jest.fn(),
}));

const ANA = { id: 'ana', name: 'Ana' } as User;

/** 8 avisos sin leer, como los que reportó el PO. */
const SIN_LEER = Array.from({ length: 8 }, (_, i) => ({
  id: `n${i}`,
  createdAt: 1_000 + i,
  readAt: null,
  notice: { kind: 'expenses' as const, groupId: 'g1', groupName: 'Asado', count: 1 },
}));

beforeEach(() => {
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [ANA] });
  useGroupStore.setState({ groups: [] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  useNoticeInboxStore.setState({ items: SIN_LEER });
});

/**
 * **El contador de la campana, en las SEIS tabs.**
 *
 * El PO: «la campana tiene 8 nuevas, en todas las tabs se muestra sobre la
 * campana menos en Cuenta». Las seis usan el mismo `TabHeader`, así que o hay
 * una diferencia que no se ve leyendo el código, o el aparato tenía un bundle
 * viejo en esa pantalla. Este test decide cuál de las dos.
 */
describe('el contador de avisos aparece en todas las tabs', () => {
  const TABS: [string, () => React.ComponentType][] = [
    ['Cuenta',    () => require('@/app/(tabs)/index').default],
    ['Personal',  () => require('@/app/(tabs)/personal').default],
    ['Amigos',    () => require('@/app/(tabs)/friends').default],
    ['Grupos',    () => require('@/app/(tabs)/groups').default],
    ['Actividad', () => require('@/app/(tabs)/activity').default],
    ['Yo',        () => require('@/app/(tabs)/user').default],
  ];

  it.each(TABS)('%s muestra el badge con 8', (nombre, cargar) => {
    const Pantalla = cargar();
    const r = render(<Pantalla />);

    expect(`${nombre}: ${r.queryAllByTestId('notice-badge').length}`).toBe(`${nombre}: 1`);
    expect(`${nombre}: ${r.getByTestId('notice-badge').props.children ? 'con texto' : 'vacio'}`)
      .toBe(`${nombre}: con texto`);
    expect(r.getAllByText('8').length).toBeGreaterThan(0);
  });
});


/**
 * **Todas las tabs tienen que decir el MISMO número, y cambiarlo a la vez.**
 *
 * El PO: «sigo viendo que el contador de notis no es el mismo en todas las
 * tabs». La causa era el patrón `useNoticeInboxStore(s => s.unreadCount)()`,
 * roto de dos formas: se suscribía a la FUNCIÓN —cuya referencia nunca cambia,
 * así que esa suscripción no redibujaba nunca— y además llamaba `get()` durante
 * el render, salteándose el snapshot suscrito. Con seis headers montados a la
 * vez, cada uno podía renderizar contra un estado distinto.
 *
 * Este test monta DOS tabs en el mismo árbol, que es lo que reproduce el
 * desacuerdo. Con una sola pantalla el bug no se ve.
 */
describe('el contador es el mismo en todas, y se mueve junto', () => {
  it('dos tabs montadas a la vez dicen lo mismo', () => {
    const Cuenta    = require('@/app/(tabs)/index').default;
    const Actividad = require('@/app/(tabs)/activity').default;

    const r = render(<><Cuenta /><Actividad /></>);
    expect(r.getAllByTestId('notice-badge')).toHaveLength(2);
    expect(r.getAllByText('8')).toHaveLength(2);
  });

  it('marcar uno leído baja el número en las DOS', () => {
    const Cuenta    = require('@/app/(tabs)/index').default;
    const Actividad = require('@/app/(tabs)/activity').default;

    const r = render(<><Cuenta /><Actividad /></>);
    act(() => { useNoticeInboxStore.getState().markRead('n0'); });

    expect(r.getAllByText('7')).toHaveLength(2);
    expect(r.queryAllByText('8')).toHaveLength(0);
  });

  it('marcar todo leído apaga el badge en las dos', () => {
    const Cuenta    = require('@/app/(tabs)/index').default;
    const Actividad = require('@/app/(tabs)/activity').default;

    const r = render(<><Cuenta /><Actividad /></>);
    act(() => { useNoticeInboxStore.getState().markAllRead(); });

    expect(r.queryAllByTestId('notice-badge')).toHaveLength(0);
  });
});
