import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';

jest.mock('@/src/sync/accountReconnect', () => ({ reconectarCuentaInteractivo: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { SinSesionDeSync } from '@/src/components/SinSesionDeSync';
import { setUltimaSesionConocida, __resetSessionStatus } from '@/src/sync/sessionStatus';
import { reconectarCuentaInteractivo } from '@/src/sync/accountReconnect';
import { useAuthStore } from '@/src/store/authStore';
import type { User } from '@/src/types/models';

const mockReconectar = reconectarCuentaInteractivo as jest.Mock;

beforeEach(() => {
  mockReconectar.mockReset().mockResolvedValue(true);
  useAuthStore.setState({ currentUser: { id: 'g1', authProvider: 'guest' } as User });
});

describe('SinSesionDeSync (T-147, enmienda PO)', () => {
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
   * Verifier D3: `sinSesion` como default param sobre una variable de módulo
   * SIN suscripción no re-renderiza cuando ese valor cambia — en la app real
   * "parecía" funcionar sólo porque la pantalla de "Yo" ya re-renderiza cada
   * 2s por OTRO `useLiveValue`. Acá, sin pasar el prop a mano, tiene que
   * aparecer y retirarse solo.
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

  /**
   * Verifier R3-1: para el invitado el aviso original («se va a resolver
   * solo») sigue siendo cierto — el reintento anónimo es automático. Para una
   * CUENTA (Google/Apple) no siempre lo es (Apple nunca reconecta en
   * silencio), así que el texto cambia y aparece un botón «Reconectar».
   */
  describe('cuenta vs. invitado', () => {
    it('invitado: texto de "se resuelve solo", SIN botón Reconectar', () => {
      useAuthStore.setState({ currentUser: { id: 'g1', authProvider: 'guest' } as User });
      const { getByText, queryByText } = render(<SinSesionDeSync sinSesion />);
      expect(getByText('sync.no_session_body')).toBeTruthy();
      expect(queryByText('sync.reconnect')).toBeNull();
    });

    it('cuenta Google/Apple: texto distinto CON botón «Reconectar»', () => {
      useAuthStore.setState({ currentUser: { id: 'acc1', authProvider: 'google' } as User });
      const { getByText, queryByText } = render(<SinSesionDeSync sinSesion />);
      expect(getByText('sync.no_session_account_body')).toBeTruthy();
      expect(queryByText('sync.no_session_body')).toBeNull();
      expect(getByText('sync.reconnect')).toBeTruthy();
    });

    it('tocar «Reconectar» dispara la reconexión interactiva', async () => {
      useAuthStore.setState({ currentUser: { id: 'acc1', authProvider: 'apple' } as User });
      const { getByText } = render(<SinSesionDeSync sinSesion />);

      await act(async () => { fireEvent.press(getByText('sync.reconnect')); });

      expect(mockReconectar).toHaveBeenCalled();
    });
  });
});
