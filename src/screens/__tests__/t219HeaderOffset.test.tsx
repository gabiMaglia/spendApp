import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { FlashList } from '@shopify/flash-list';

import ActivityScreen from '@/app/(tabs)/activity';
import GroupsScreen from '@/app/(tabs)/groups';
import FriendsScreen from '@/app/(tabs)/friends';
import { TITLE_BLOCK_H } from '@/src/constants/header';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';
import { useSettingsStore } from '@/src/store/settingsStore';

// Este archivo prueba el skin Clásico. Desde 2026-09-29 el skin inicial es Aero,
// así que se fija Clásico explícitamente.
beforeEach(() => { useSettingsStore.setState({ skin: 'default' }); });

/**
 * T-219 (regresión de T-154, PO en el Moto, Clásico): la franja "Hoy" en
 * Actividad y el bloque de contadores en Grupos/Amigos quedan por detrás del
 * header colapsable en vez de chocar borde con borde, como antes de T-154.
 *
 * Causa raíz: `contentContainerStyle.paddingTop` no alcanza a compensar el
 * alto del header para lo primero que dibuja `AnimatedFlashList`
 * (`ListHeaderComponent` en Grupos/Amigos, la primera fila del canvas en
 * Actividad) — FlashList v2 posiciona su canvas virtualizado midiendo dónde
 * termina el `ListHeaderComponent`, no leyendo el padding de la ScrollView
 * como hacía `Animated.ScrollView` antes de T-154. El offset tiene que vivir
 * en `ListHeaderComponentStyle`, que si se mide en flujo real.
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

function flashListPropsOf(ui: React.ReactElement) {
  const r = render(ui);
  const el = r.UNSAFE_getByType(FlashList as any);
  return {
    contentContainerStyle: StyleSheet.flatten(el.props.contentContainerStyle) ?? {},
    listHeaderComponentStyle: StyleSheet.flatten(el.props.ListHeaderComponentStyle) ?? {},
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

describe('T-219 — offset del header colapsable llega al primer bloque', () => {
  it('Actividad: ListHeaderComponentStyle trae el paddingTop que compensa el header', () => {
    const { contentContainerStyle, listHeaderComponentStyle } = flashListPropsOf(<ActivityScreen />);
    expect(listHeaderComponentStyle.paddingTop).toBe(TITLE_BLOCK_H);
    // Ya no debe vivir en contentContainerStyle: ahí no llega a compensar el
    // header del primer ítem del canvas (la franja "Hoy").
    expect(contentContainerStyle.paddingTop).toBeUndefined();
  });

  it('Grupos: ListHeaderComponentStyle trae el paddingTop que compensa el header', () => {
    const { contentContainerStyle, listHeaderComponentStyle } = flashListPropsOf(<GroupsScreen />);
    expect(listHeaderComponentStyle.paddingTop).toBe(TITLE_BLOCK_H);
    expect(contentContainerStyle.paddingTop).toBeUndefined();
  });

  it('Amigos: ListHeaderComponentStyle trae el paddingTop que compensa el header', () => {
    const { contentContainerStyle, listHeaderComponentStyle } = flashListPropsOf(<FriendsScreen />);
    expect(listHeaderComponentStyle.paddingTop).toBe(TITLE_BLOCK_H);
    expect(contentContainerStyle.paddingTop).toBeUndefined();
  });
});
