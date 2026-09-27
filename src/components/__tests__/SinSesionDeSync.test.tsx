import React from 'react';
import { render, act } from '@testing-library/react-native';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { SinSesionDeSync } from '@/src/components/SinSesionDeSync';
import { setUltimaSesionConocida, __resetSessionStatus } from '@/src/sync/sessionStatus';
import { useAuthStore } from '@/src/store/authStore';
import type { User } from '@/src/types/models';

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: 'g1', authProvider: 'guest' } as User });
});

/**
 * T-147 (SIMPLIFICACIÓN, PO 2026-09-27): el aviso ya NO distingue invitado de
 * cuenta — el buzón usa la MISMA sesión anónima por instalación para los
 * dos, y no hay ningún botón «Reconectar» del lado del buzón (eso era del
 * diseño viejo, atado a la cuenta — se borró junto con `accountReconnect`).
 */
describe('SinSesionDeSync (T-147, simplificación)', () => {
  it('sin sesión, avisa que este teléfono no está sincronizando', () => {
    const { getByText } = render(<SinSesionDeSync sinSesion />);
    expect(getByText('sync.no_session_title')).toBeTruthy();
    expect(getByText('sync.no_session_body')).toBeTruthy();
  });

  it('con sesión, no dibuja nada', () => {
    const { queryByText } = render(<SinSesionDeSync sinSesion={false} />);
    expect(queryByText('sync.no_session_title')).toBeNull();
  });

  it('nunca dibuja un botón «Reconectar» (no hay cuenta que reconectar en el buzón)', () => {
    useAuthStore.setState({ currentUser: { id: 'acc1', authProvider: 'google' } as User });
    const { queryByText } = render(<SinSesionDeSync sinSesion />);
    expect(queryByText('sync.reconnect')).toBeNull();
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
