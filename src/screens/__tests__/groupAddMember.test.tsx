import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import GroupDetailScreen from '@/app/groups/[id]';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { MAX_MIEMBROS } from '@/src/sync/topes';
import type { Group, User } from '@/src/types/models';

/**
 * Sumar gente al grupo (T-039).
 *
 * Antes la ÚNICA forma era escribir un nombre, que creaba un usuario con un
 * uuid al azar: alguien que jamás iba a poder recibir la clave del grupo ni
 * sincronizar nada. Un callejón sin salida presentado como si funcionara.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: 'g1' }),
}));

const ANA  = { id: 'ana',  name: 'Ana',  isDeleted: false } as User;
const BETO = { id: 'beto', name: 'Beto', isDeleted: false } as User;

const grupo = (memberIds = ['ana']): Group => ({
  id: 'g1', name: 'Asado', memberIds, currency: 'ARS',
  // T-182: `miembros` es la fuente de verdad de `memberIds` (derivado).
  miembros: Object.fromEntries(memberIds.map((uid, i) => [uid, { estado: 'in' as const, at: i }])),
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group);

beforeEach(() => {
  createSecureStorage('groups').clearAll();
  createSecureStorage('groupkeys').clearAll();
  useAuthStore.setState({ currentUser: ANA });
  useGroupStore.setState({ groups: [grupo()] });
  useUserStore.setState({ users: [ANA, BETO] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  useGroupKeyStore.setState({ keys: [] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => { jest.restoreAllMocks(); });

// "Agregar persona" dejo de estar suelto en la pantalla y vive en el menu de
// los 3 puntos (PO 2026-08-30): estaba demasiado a mano, igual que borrar el
// grupo. Cambia el camino, no lo que este archivo prueba.
function abrirModal(r: ReturnType<typeof render>) {
  fireEvent.press(r.getByTestId('group-options'));
  fireEvent.press(r.getByText('group_detail.add_person'));
}

describe('agregar miembros', () => {
  it('ofrece los contactos que todavía no están en el grupo', () => {
    const r = render(<GroupDetailScreen />);
    abrirModal(r);

    expect(r.getByText('Beto')).toBeTruthy();
  });

  it('no ofrece a quien ya es miembro', () => {
    useGroupStore.setState({ groups: [grupo(['ana', 'beto'])] });

    const r = render(<GroupDetailScreen />);
    abrirModal(r);

    expect(r.queryByText('group_detail.add_from_contacts')).toBeNull();
  });

  // Sumar un contacto le entrega la clave: es el camino que SÍ sincroniza.
  it('sumar un contacto lo mete en el grupo y le crea la clave', () => {
    const r = render(<GroupDetailScreen />);
    abrirModal(r);

    fireEvent.press(r.getByText('Beto'));

    expect(useGroupStore.getState().getById('g1')!.memberIds).toContain('beto');
    expect(useGroupKeyStore.getState().getKey('g1')).toBeTruthy();
  });

  // Se puede seguir agregando a alguien sin app, pero deja de estar oculto
  // detrás de un campo de texto que parecía el camino normal.
  it('el alta sin app está, pero detrás de una opción explícita', () => {
    const r = render(<GroupDetailScreen />);
    abrirModal(r);

    expect(r.queryByPlaceholderText('group_detail.name_placeholder')).toBeNull();

    fireEvent.press(r.getByText('group_detail.add_without_app'));

    expect(r.getByPlaceholderText('group_detail.name_placeholder')).toBeTruthy();
  });

  it('y avisa que esa persona NO va a ver el grupo', () => {
    const r = render(<GroupDetailScreen />);
    abrirModal(r);
    fireEvent.press(r.getByText('group_detail.add_without_app'));

    expect(r.getByText('group_detail.without_app_warning')).toBeTruthy();
  });

  // Antes decía "cuando sincronicen por QR su cuenta quedará vinculada", que
  // era simplemente falso.
  it('al confirmar, el aviso dice la verdad y no promete un sync que no pasa', () => {
    const r = render(<GroupDetailScreen />);
    abrirModal(r);
    fireEvent.press(r.getByText('group_detail.add_without_app'));
    fireEvent.changeText(r.getByPlaceholderText('group_detail.name_placeholder'), 'Tio Pepe');
    fireEvent.press(r.getByText('group_detail.add_to_group'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'group_detail.member_added_title',
      'group_detail.without_app_warning',
    );
  });
});

// T-150 ronda 2 (D4, verifier): un grupo nunca debe superar MAX_MIEMBROS por
// un camino honesto de la UI — ni sumando un contacto, ni dando de alta a
// alguien "sin app".
describe('tope de miembros al agregar (T-150 ronda 2, D4)', () => {
  function grupoLleno(): Group {
    return {
      id: 'g1', name: 'Asado',
      memberIds: Array.from({ length: MAX_MIEMBROS }, (_, i) => `u${i}`),
      currency: 'ARS', createdAt: 0, createdById: 'u0', deletionVotes: [],
      updatedAt: 0, isDeleted: false,
    } as Group;
  }

  beforeEach(() => {
    useGroupStore.setState({ groups: [grupoLleno()] });
    useAuthStore.setState({ currentUser: { id: 'u0', name: 'U0', isDeleted: false } as User });
    useUserStore.setState({
      users: [
        ...Array.from({ length: MAX_MIEMBROS }, (_, i) => ({ id: `u${i}`, name: `U${i}`, isDeleted: false }) as User),
        BETO,
      ],
    });
  });

  it('bloquea sumar un contacto cuando el grupo ya está en el tope', () => {
    const r = render(<GroupDetailScreen />);
    abrirModal(r);

    fireEvent.press(r.getByText('Beto'));

    expect(useGroupStore.getState().getById('g1')!.memberIds).not.toContain('beto');
    expect(Alert.alert).toHaveBeenCalled();
  });

  it('bloquea el alta "sin app" cuando el grupo ya está en el tope', () => {
    const r = render(<GroupDetailScreen />);
    abrirModal(r);
    fireEvent.press(r.getByText('group_detail.add_without_app'));
    fireEvent.changeText(r.getByPlaceholderText('group_detail.name_placeholder'), 'Tio Pepe');
    fireEvent.press(r.getByText('group_detail.add_to_group'));

    expect(useGroupStore.getState().getById('g1')!.memberIds).toHaveLength(MAX_MIEMBROS);
  });
});

// T-101: reconectar a un miembro que reinstaló y perdió su clave de grupo — el
// mismo menú de opciones abre la pantalla de escanear contacto, directo en cámara.
describe('validar miembro (T-101)', () => {
  it('el botón "Validar miembro" abre el escaneo de contacto directo en modo cámara', () => {
    const r = render(<GroupDetailScreen />);
    fireEvent.press(r.getByTestId('group-options'));
    fireEvent.press(r.getByText('group_detail.validate_member'));

    expect(router.push).toHaveBeenCalledWith('/contact/add?mode=scan');
  });
});
