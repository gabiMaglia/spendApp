import React from 'react';
import { render, act } from '@testing-library/react-native';

import { SinSesionDeSync } from '@/src/components/SinSesionDeSync';
import { setUltimaSesionConocida, __resetSessionStatus } from '@/src/sync/sessionStatus';

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
});
