import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { render, renderHook, screen } from '@testing-library/react-native';

import AddContactScreen from '@/app/contact/add';
import SettleNewScreen from '@/app/settle/new';
import { useRellenoDetailHeader } from '@/src/components/CollapsibleHeader';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useSettingsStore } from '@/src/store/settingsStore';
import { useUserStore } from '@/src/store/userStore';
import type { Group, User } from '@/src/types/models';

/**
 * T-227 punto 5: con el header de detalle flotando en Aero, cada pantalla
 * baja su contenido lo que ocupa la tarjeta (`useRellenoDetailHeader`), así
 * nada arranca tapado. Una con scroll (Saldar) y una sin scroll (Agregar
 * contacto). En Clásico, lo de siempre.
 */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/motor/relayEngine', () => ({ deviceId: () => 'dev-1', schedulePublish: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => ({ groupId: 'g1' }),
}));
jest.mock('react-native-qrcode-svg', () => () => null);
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));

const YO = { id: 'yo', name: 'Yo', isDeleted: false } as User;
const ANA = { id: 'ana', name: 'Ana', isDeleted: false } as User;

beforeEach(() => {
  useAuthStore.setState({ currentUser: YO });
  useUserStore.setState({ users: [YO, ANA] });
  useGroupStore.setState({
    groups: [{
      id: 'g1', name: 'G', memberIds: ['yo', 'ana'], currency: 'ARS', miembros: {},
      createdAt: 0, createdById: 'yo', updatedAt: 0, isDeleted: false,
    } as unknown as Group],
  });
});

function paddingTopDelScroll(skin: 'default' | 'aero'): number {
  useSettingsStore.setState({ skin, reduceAnimations: true });
  const r = render(<SettleNewScreen />);
  const pt = StyleSheet.flatten(r.UNSAFE_getAllByType(ScrollView)[0].props.contentContainerStyle).paddingTop;
  r.unmount();
  return Number(pt ?? 0);
}

describe('pantallas de detalle: el contenido arranca debajo del header', () => {
  it('con scroll (Saldar): en Aero suma el relleno al padding de arriba que ya tenía', () => {
    const clasico = paddingTopDelScroll('default');
    const aero = paddingTopDelScroll('aero');
    useSettingsStore.setState({ skin: 'aero' });
    const relleno = renderHook(() => useRellenoDetailHeader()).result.current;
    expect(relleno).toBeGreaterThan(0);
    expect(aero).toBe(clasico + relleno);
  });

  it('sin scroll (Agregar contacto): en Aero deja el hueco de la tarjeta; en Clásico no', () => {
    useSettingsStore.setState({ skin: 'aero', reduceAnimations: true });
    const r = render(<AddContactScreen />);
    expect(screen.getByTestId('relleno-detail-header', { includeHiddenElements: true })).toBeTruthy();
    r.unmount();

    useSettingsStore.setState({ skin: 'default' });
    render(<AddContactScreen />);
    expect(screen.queryByTestId('relleno-detail-header', { includeHiddenElements: true })).toBeNull();
  });
});
