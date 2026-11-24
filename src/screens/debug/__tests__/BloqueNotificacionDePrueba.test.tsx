import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { BloqueNotificacionDePrueba } from '@/src/screens/debug/components/BloqueNotificacionDePrueba';
import { programarResumenDePrueba } from '@/src/screens/debug/notificacionDePrueba';

jest.mock('@/src/screens/debug/notificacionDePrueba', () => ({ programarResumenDePrueba: jest.fn() }));

const c = { textSecondary: '#000', text: '#000', border: '#000', semantic: { positive: '#0a0' } };

/** Botón del Diagnóstico (sólo DEV) que programa el resumen de avisos. */
describe('BloqueNotificacionDePrueba', () => {
  it('al tocarlo programa el resumen a 10 s y avisa que salgas de la app', async () => {
    (programarResumenDePrueba as jest.Mock).mockResolvedValueOnce(true);
    const { getByText, findByTestId } = render(<BloqueNotificacionDePrueba c={c} />);
    fireEvent.press(getByText('Probar notificación de resumen'));
    expect(programarResumenDePrueba).toHaveBeenCalledWith(10);
    expect((await findByTestId('noti-prueba-estado')).props.children).toMatch(/10 s/);
  });

  it('si no se pudo programar, lo dice', async () => {
    (programarResumenDePrueba as jest.Mock).mockResolvedValueOnce(false);
    const { getByText, findByTestId } = render(<BloqueNotificacionDePrueba c={c} />);
    fireEvent.press(getByText('Probar notificación de resumen'));
    await waitFor(async () => expect((await findByTestId('noti-prueba-estado')).props.children).toMatch(/permiso/));
  });
});
