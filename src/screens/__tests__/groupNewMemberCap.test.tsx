import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import NewGroupScreen from '@/app/groups/new';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { MAX_MIEMBROS } from '@/src/sync/nucleo/topes';
import type { User } from '@/src/types/models';

/**
 * T-150 ronda 2 — Defecto 1 del handoff (verifier, ronda 2): `app/groups/
 * new.tsx` armaba `memberIds` sin llamar nunca a `admiteUnMiembroMas`. Con
 * >=100 contactos salía un grupo de 101 miembros que `excesoDe` marca
 * `memberIds` y que el relay excluye en silencio de toda publicación — nadie
 * más lo recibe. El mismo tope que ya protege "agregar miembro" en
 * `app/groups/[id].tsx` (ver `groupAddMember.test.tsx`) tiene que aplicar acá.
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

function contactos(n: number): User[] {
  return Array.from({ length: n }, (_, i) => ({ id: `u${i}`, name: `U${i}`, isDeleted: false }) as User);
}

beforeEach(() => {
  createSecureStorage('groups').clearAll();
  createSecureStorage('groupkeys').clearAll();
  useAuthStore.setState({ currentUser: ANA });
  useGroupStore.setState({ groups: [] });
  useGroupKeyStore.setState({ keys: [] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => { jest.restoreAllMocks(); });

describe('tope de miembros al crear un grupo (T-150 ronda 2, defecto 1)', () => {
  it('no deja seleccionar un contacto que haría superar MAX_MIEMBROS, y avisa', () => {
    useUserStore.setState({ users: contactos(MAX_MIEMBROS) }); // u0..u99

    const r = render(<NewGroupScreen />);

    // Ana ya cuenta como miembro (1). Sumar u0..u98 (99 más) llega a MAX_MIEMBROS.
    for (let i = 0; i < MAX_MIEMBROS - 1; i++) {
      fireEvent.press(r.getByText(`U${i}`));
    }

    // El grupo ya está en el tope: u99 no puede sumarse.
    fireEvent.press(r.getByText(`U${MAX_MIEMBROS - 1}`));

    fireEvent.changeText(r.getByPlaceholderText('groups.name_placeholder'), 'Grupo grande');
    fireEvent.press(r.getByText('common.create'));

    const creado = useGroupStore.getState().groups[0];
    expect(creado.memberIds).toHaveLength(MAX_MIEMBROS);
    expect(creado.memberIds).not.toContain(`u${MAX_MIEMBROS - 1}`);
    expect(Alert.alert).toHaveBeenCalled();
  });

  it('sin llegar al tope, todos los seleccionados entran', () => {
    useUserStore.setState({ users: contactos(3) });

    const r = render(<NewGroupScreen />);
    fireEvent.press(r.getByText('U0'));
    fireEvent.press(r.getByText('U1'));

    fireEvent.changeText(r.getByPlaceholderText('groups.name_placeholder'), 'Grupo chico');
    fireEvent.press(r.getByText('common.create'));

    const creado = useGroupStore.getState().groups[0];
    expect(creado.memberIds).toEqual(expect.arrayContaining(['ana', 'u0', 'u1']));
    expect(creado.memberIds).toHaveLength(3);
  });
});
