import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import NewGroupScreen from '@/app/groups/new';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupStore } from '@/src/store/groupStore';
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
  useGroupStore.setState({ groups: [] });
});

describe('botón de crear grupo en la botonera del pie', () => {
  it('el botón de crear vive en la botonera inferior (testID), no inline en el header', () => {
    const r = render(<NewGroupScreen />);
    expect(r.getByTestId('group-new-save')).toBeTruthy();
  });

  it('arranca deshabilitado sin nombre', () => {
    const r = render(<NewGroupScreen />);
    expect(r.getByTestId('group-new-save').props.accessibilityState?.disabled).toBe(true);
  });
});

/**
 * Un grupo se crea sin contactos (PO, 2026-10-12): quien entra solo —el revisor
 * de Apple, alguien que todavía no escaneó a nadie— no tenía cómo crear un grupo,
 * y sin grupo no hay gastos. Adentro se suma gente con «Agregar persona» (también
 * quien no usa la app) o por link de invitación.
 */
describe('crear un grupo sin contactos', () => {
  it('con nombre y sin contactos, «Crear» se habilita', () => {
    const r = render(<NewGroupScreen />);
    fireEvent.changeText(r.getByPlaceholderText('groups.name_placeholder'), 'Trip');
    expect(r.getByTestId('group-new-save').props.accessibilityState?.disabled).toBe(false);
  });

  it('crea el grupo con uno mismo como único miembro', () => {
    const r = render(<NewGroupScreen />);
    fireEvent.changeText(r.getByPlaceholderText('groups.name_placeholder'), 'Trip');
    fireEvent.press(r.getByTestId('group-new-save'));
    const grupos = useGroupStore.getState().groups;
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.name).toBe('Trip');
    expect(grupos[0]!.memberIds).toEqual(['ana']);
  });

  it('un nombre de puros espacios sigue sin habilitar', () => {
    const r = render(<NewGroupScreen />);
    fireEvent.changeText(r.getByPlaceholderText('groups.name_placeholder'), '   ');
    expect(r.getByTestId('group-new-save').props.accessibilityState?.disabled).toBe(true);
  });
});
