import React, { Profiler, type ProfilerOnRenderCallback } from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';

import { TabHeader } from '../TabHeader';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Group, User } from '@/src/types/models';

/**
 * T-205 — `TabHeader.tsx:69,71` suscribía el header entero a `groups` (sólo
 * usado DENTRO de handlers, al tocar un aviso) y a `inboxItems` (sólo usado
 * por la bandeja, que se abre al tocar la campana). Cualquier alta de grupo
 * en CUALQUIER parte de la app, o cualquier aviso nuevo, re-renderizaba las
 * seis tabs que montan este header.
 *
 * Fix: `groups` se lee con `useGroupStore.getState()` DENTRO del handler (sin
 * suscripción) y la bandeja de avisos se suscribe a `items` ELLA MISMA — el
 * header sólo usa `useUnreadNoticeCount()` (ya angosto) para el badge.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const ANA = { id: 'ana', name: 'Ana', isDeleted: false } as User;

function crearProgress(valor = 0) {
  return renderHook(() => useSharedValue(valor)).result.current;
}

function montarConProfiler(onRender: ProfilerOnRenderCallback) {
  return render(
    <Profiler id="tabheader" onRender={onRender}>
      <TabHeader title="Test" progress={crearProgress()} />
    </Profiler>,
  );
}

function contador() {
  const estado = { renders: 0 };
  const onRender: ProfilerOnRenderCallback = () => { estado.renders += 1; };
  return { estado, onRender };
}

const grupoNuevo = (id: string): Group => ({
  id, name: `Grupo ${id}`, memberIds: ['ana'], currency: 'ARS',
  miembros: {}, createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false,
} as Group);

beforeEach(() => {
  createSecureStorage('groups').clearAll();
  createSecureStorage('notices').clearAll();
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [ANA] });
  useGroupStore.setState({ groups: [] });
  useNoticeInboxStore.setState({ items: [] });
});

describe('T-205 — el header no escucha más de lo que necesita', () => {
  it('un grupo nuevo en cualquier parte de la app NO re-renderiza el header', () => {
    const { estado, onRender } = contador();
    montarConProfiler(onRender);
    const rendersTrasMontaje = estado.renders;

    act(() => {
      useGroupStore.getState().addGroup(grupoNuevo('g1'));
    });

    console.log('[T-205][TabHeader] rendersTrasMontaje=%s rendersTrasGrupoNuevo=%s',
      rendersTrasMontaje, estado.renders);

    expect(estado.renders).toBe(rendersTrasMontaje);
  });

  it('un aviso nuevo SÍ actualiza el badge (1 render esperado)', () => {
    const { estado, onRender } = contador();
    const r = montarConProfiler(onRender);
    const rendersTrasMontaje = estado.renders;

    act(() => {
      useNoticeInboxStore.getState().record([{ kind: 'clock_off', offsetMs: 999_000 }]);
    });

    expect(estado.renders).toBe(rendersTrasMontaje + 1);
    expect(r.getAllByText('1').length).toBeGreaterThan(0);
  });

  it('con la bandeja abierta, el aviso nuevo aparece en la lista', () => {
    const r = render(<TabHeader title="Test" progress={crearProgress()} />);

    fireEvent.press(r.getByTestId('notice-bell'));

    act(() => {
      useNoticeInboxStore.getState().record([{ kind: 'clock_off', offsetMs: 999_000 }]);
    });

    // `textFor` resuelve el texto real (no pasa por el mock de `t()` del
    // header) — se afirma sobre el título que arma para `clock_off`.
    expect(r.getByText('La hora de tu teléfono está mal')).toBeTruthy();
  });
});
