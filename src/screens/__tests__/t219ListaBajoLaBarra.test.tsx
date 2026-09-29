import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { FlashList } from '@shopify/flash-list';

import ActivityScreen from '@/app/(tabs)/activity';
import GroupsScreen from '@/app/(tabs)/groups';
import FriendsScreen from '@/app/(tabs)/friends';
import { HEADER_BAR_H } from '@/src/constants/header';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

/**
 * T-219b (PO en el Moto, Clásico, 2026-09-29): aun con el `paddingTop` en
 * `ListHeaderComponentStyle` (primera vuelta de T-219), Grupos/Actividad
 * seguían metiéndose detrás del header. Medido con `uiautomator`: el
 * ScrollView de la lista arrancaba en `y=0` en vez de a
 * `insets.top + HEADER_BAR_H` (`useLimiteContenido`).
 *
 * Causa raíz: las pestañas pasaban ese margen como `style` del
 * `Animated.createAnimatedComponent(FlashList)`. Reanimated le entrega
 * `style` al componente envuelto como ARRAY («keep styles as they were
 * passed by the user», `createAnimatedComponent/PropsFilter.js`), y FlashList
 * v2 arma su vista externa con spread de objeto
 * (`{ flex: 1, overflow: 'hidden', ...style }`, `RecyclerView.js`): el
 * spread de un array pierde `marginTop`. En Aero el margen es 0, por eso ahí
 * no se notaba.
 *
 * Regla que fija este test: el margen bajo la barra vive en un `View`
 * envolvente, y el `FlashList` NO recibe `style` con `marginTop`. El mock de
 * FlashList es un Fragment, así que acá se afirma sobre el árbol de React,
 * no sobre el layout nativo (que se verificó en el dispositivo).
 */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/motor/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}),
}));

const ANA = { id: 'ana', name: 'Ana' } as User;

function margenesDe(ui: React.ReactElement) {
  const r = render(ui);
  const lista = r.UNSAFE_getByType(FlashList as any);
  // Primer ancestro que sea un `View` NATIVO (host, `type === 'View'`) con
  // `marginTop`: el envoltorio de Reanimated (`AnimatedComponent`) también
  // lleva el style en sus props y NO cuenta — es justo el que lo pierde.
  let p = lista.parent;
  while (p && !(p.type === 'View' && StyleSheet.flatten(p.props.style)?.marginTop !== undefined)) p = p.parent;
  return {
    enLaLista: StyleSheet.flatten(lista.props.style)?.marginTop,
    enElEnvolvente: p ? StyleSheet.flatten(p.props.style).marginTop : undefined,
  };
}

beforeEach(() => {
  createSecureStorage('groups').clearAll();
  useAuthStore.setState({ currentUser: ANA });
  useGroupStore.setState({ groups: [] });
  useArchiveStore.setState({ archivedIds: [] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
});

// En test insets.top = 0, así que el límite del contenido (Clásico) es HEADER_BAR_H.
describe.each([
  ['Actividad', () => <ActivityScreen />],
  ['Grupos', () => <GroupsScreen />],
  ['Amigos', () => <FriendsScreen />],
])('T-219b — %s: el margen bajo la barra no viaja en el style del FlashList', (_nombre, ui) => {
  it('el FlashList no recibe marginTop en style (Reanimated lo pasa como array y FlashList lo pierde)', () => {
    expect(margenesDe(ui()).enLaLista).toBeUndefined();
  });

  it('un View envolvente lleva el marginTop de useLimiteContenido', () => {
    expect(margenesDe(ui()).enElEnvolvente).toBe(HEADER_BAR_H);
  });
});
