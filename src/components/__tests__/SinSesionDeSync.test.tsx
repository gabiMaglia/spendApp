import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));

import { SinSesionDeSync } from '@/src/components/SinSesionDeSync';
import { setUltimaSesionConocida, __resetSessionStatus } from '@/src/sync/sesion/sessionStatus';
import { useAuthStore } from '@/src/store/authStore';
import { useEntryGateStore, __resetEntryGate } from '@/src/store/entryGateStore';
import type { User } from '@/src/types/models';

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: 'g1', authProvider: 'guest' } as User });
  __resetEntryGate();
  mockPush.mockClear();
});

/**
 * T-147-b (`engram/plans/T-147.md`, Task 4, sellado por el PO 2026-09-27):
 * el aviso sigue sin distinguir invitado de cuenta en el MENSAJE (las dos
 * causas posibles de "no me está llegando nada" se explican igual), pero
 * ahora SÍ tiene una acción — filas 9/10 de la tabla: "aviso con acción" que
 * lleva de vuelta a la pantalla de entrada, donde cada modo (cuenta o
 * invitado) sabe qué hacer.
 */
describe('SinSesionDeSync (T-147-b)', () => {
  it('sin sesión, avisa que este teléfono no está sincronizando', () => {
    const { getByText } = render(<SinSesionDeSync sinSesion />);
    expect(getByText('sync.no_session_title')).toBeTruthy();
    expect(getByText('sync.no_session_body')).toBeTruthy();
  });

  it('con sesión, no dibuja nada', () => {
    const { queryByText } = render(<SinSesionDeSync sinSesion={false} />);
    expect(queryByText('sync.no_session_title')).toBeNull();
  });

  /**
   * Filas 9/10: tocar el aviso pide la verificación de nuevo (el gate vuelve
   * a 'pendiente' — si no, `AuthGuard` la manda directo de vuelta a tabs,
   * `decidirNavegacionAuthGuard` sólo va a `/auth/verify` con gate
   * 'pendiente') y navega a la pantalla de entrada — sirve igual para
   * cuenta (fila 9) que para invitado (fila 10): cada modo de `verify.tsx`
   * sabe qué hacer solo.
   */
  it('tocar el aviso pide la verificación de nuevo y navega a la entrada', () => {
    useAuthStore.setState({ currentUser: { id: 'acc1', authProvider: 'google' } as User });
    const { getByText } = render(<SinSesionDeSync sinSesion />);

    fireEvent.press(getByText('sync.no_session_title'));

    expect(useEntryGateStore.getState().estado).toBe('pendiente');
    expect(mockPush).toHaveBeenCalledWith('/auth/verify');
  });

  it('funciona igual para invitado', () => {
    useAuthStore.setState({ currentUser: { id: 'g1', authProvider: 'guest' } as User });
    const { getByText } = render(<SinSesionDeSync sinSesion />);

    fireEvent.press(getByText('sync.no_session_title'));

    expect(useEntryGateStore.getState().estado).toBe('pendiente');
    expect(mockPush).toHaveBeenCalledWith('/auth/verify');
  });

  it('el mensaje es el mismo para invitado y para cuenta', () => {
    useAuthStore.setState({ currentUser: { id: 'acc1', authProvider: 'apple' } as User });
    const cuenta = render(<SinSesionDeSync sinSesion />);
    expect(cuenta.getByText('sync.no_session_body')).toBeTruthy();
  });

  /**
   * Verifier D3 (heredado): `sinSesionDeSync()` lee una variable de módulo
   * SIN suscripción — sin `useLiveValue` no se entera cuando cambia sola.
   */
  describe('reactivo a la sesión real, SIN pasar el prop a mano', () => {
    beforeEach(() => { __resetSessionStatus(); jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it('aparece cuando la sesión se pierde y se retira al recuperarla', () => {
      const { queryByText } = render(<SinSesionDeSync />);
      expect(queryByText('sync.no_session_title')).toBeNull();

      setUltimaSesionConocida('none');
      act(() => { jest.advanceTimersByTime(2_000); });
      expect(queryByText('sync.no_session_title')).toBeTruthy();

      setUltimaSesionConocida('anonymous');
      act(() => { jest.advanceTimersByTime(2_000); });
      expect(queryByText('sync.no_session_title')).toBeNull();
    });
  });
});
