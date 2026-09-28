import React from 'react';
import { render } from '@testing-library/react-native';
import NewGroupScreen from '@/app/groups/new';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import type { User } from '@/src/types/models';

/**
 * U3 (lote UI 2026-09-28): «Crear» no seguía la norma del resto de pantallas
 * de creación (Nuevo gasto, Registrar pago) — vivía inline en el header en vez
 * de la botonera del pie (`ButtonRack`/`ActionButton`, PO). Este test fija que
 * el botón vive en esa botonera (`testID`), no que se vea de determinada forma.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
}));
jest.mock('@/src/sync/motor/relayEngine', () => ({
  announceGroupToContacts: jest.fn(),
  schedulePublish: jest.fn(),
  deviceId: () => 'dev-1',
}));

const ANA = { id: 'ana', name: 'Ana', isDeleted: false } as User;

beforeEach(() => {
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [] });
});

describe('botón de crear grupo en la botonera del pie', () => {
  it('el botón de crear vive en la botonera inferior (testID), no inline en el header', () => {
    const r = render(<NewGroupScreen />);
    expect(r.getByTestId('group-new-save')).toBeTruthy();
  });

  it('arranca deshabilitado sin nombre ni contacto seleccionado', () => {
    const r = render(<NewGroupScreen />);
    expect(r.getByTestId('group-new-save').props.accessibilityState?.disabled).toBe(true);
  });
});
