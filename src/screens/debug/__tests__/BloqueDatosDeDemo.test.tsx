import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import { BloqueDatosDeDemo } from '@/src/screens/debug/components/BloqueDatosDeDemo';
import { GRUPO_DEMO_ID } from '@/src/screens/debug/datosDeDemo';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('@/src/sync/motor/relayEngine', () => ({
  deviceId: () => 'dev', schedulePublish: jest.fn(), olvidarCursor: jest.fn(),
  publishNow: jest.fn(async () => {}),
}));

const c = { textSecondary: '#000', text: '#000', border: '#000', semantic: { positive: '#0a0' } };

/** Botón del Diagnóstico (sólo DEV) que carga los datos de demo de las capturas. */
describe('BloqueDatosDeDemo', () => {
  beforeEach(() => {
    useGroupStore.setState({ groups: [] });
    useAuthStore.setState({ currentUser: { id: 'u_yo' } as never });
  });

  it('al tocarlo carga el grupo de demo en la cuenta activa y vuelve a Personal', () => {
    const { getByText } = render(<BloqueDatosDeDemo c={c} />);
    fireEvent.press(getByText('Cargar datos de demo'));
    const g = useGroupStore.getState().groups.find(x => x.id === GRUPO_DEMO_ID);
    expect(g?.memberIds).toContain('u_yo');
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('sin cuenta activa no carga nada', () => {
    useAuthStore.setState({ currentUser: null });
    const { getByText } = render(<BloqueDatosDeDemo c={c} />);
    fireEvent.press(getByText('Cargar datos de demo'));
    expect(useGroupStore.getState().groups).toHaveLength(0);
  });
});
