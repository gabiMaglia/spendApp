import React from 'react';
import { render } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';
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
