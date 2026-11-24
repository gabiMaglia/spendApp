import { programarResumenDePrueba } from '@/src/screens/debug/notificacionDePrueba';
import { DESTINO_RESUMEN } from '@/src/services/notifications';
import { cargarNotificaciones } from '@/src/services/nativoNotificaciones';

jest.mock('@/src/services/nativoNotificaciones', () => ({ cargarNotificaciones: jest.fn() }));
jest.mock('@/src/services/notifications', () => ({
  DESTINO_RESUMEN: '/(tabs)/activity',
  ensurePermission: jest.fn(async () => true),
}));

const programar = jest.fn(async () => 'id');
const nativo = {
  scheduleNotificationAsync: programar,
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
};

/**
 * Botón de Diagnóstico (sólo DEV): programa la notificación de resumen para
 * probar el tap con la app en segundo plano o cerrada (T-304 D1) sin otro
 * teléfono.
 */
describe('programarResumenDePrueba', () => {
  beforeEach(() => {
    programar.mockClear();
    (cargarNotificaciones as jest.Mock).mockReturnValue(nativo);
  });

  it('programa UNA notificación de resumen, con destino Actividad, a los segundos pedidos', async () => {
    expect(await programarResumenDePrueba(10, true)).toBe(true);
    expect(programar).toHaveBeenCalledTimes(1);
    const [arg] = programar.mock.calls[0] as any[];
    expect(arg.content.data).toEqual({ destino: DESTINO_RESUMEN });
    expect(arg.content.title).toBeTruthy();
    expect(arg.trigger).toEqual({ type: 'timeInterval', seconds: 10 });
  });

  it('sin el módulo nativo no programa nada', async () => {
    (cargarNotificaciones as jest.Mock).mockReturnValue(null);
    expect(await programarResumenDePrueba(10, true)).toBe(false);
  });

  it('sin permiso no programa nada', async () => {
    const { ensurePermission } = jest.requireMock('@/src/services/notifications');
    ensurePermission.mockResolvedValueOnce(false);
    expect(await programarResumenDePrueba(10, true)).toBe(false);
    expect(programar).not.toHaveBeenCalled();
  });

  it('fuera de desarrollo no hace nada', async () => {
    expect(await programarResumenDePrueba(10, false)).toBe(false);
    expect(programar).not.toHaveBeenCalled();
  });
});
