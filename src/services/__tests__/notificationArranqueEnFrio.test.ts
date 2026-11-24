import { atenderRespuestaDeArranque, onNotificationTap, olvidarRespuestasAtendidas } from '@/src/services/notificacionTap';

let mockUltima: unknown = null;
let mockListener: ((r: unknown) => void) | null = null;

jest.mock('expo-notifications', () => ({
  getLastNotificationResponse: () => mockUltima,
  addNotificationResponseReceivedListener: (fn: (r: unknown) => void) => {
    mockListener = fn;
    return { remove: jest.fn() };
  },
}));

const respuesta = (identifier: string, data: Record<string, unknown>) => ({
  notification: { request: { identifier, content: { data } } },
});

beforeEach(() => {
  mockUltima = null;
  mockListener = null;
  olvidarRespuestasAtendidas();
});

describe('tap con la app cerrada (T-304 D1)', () => {
  it('navega una sola vez al destino de la última respuesta', () => {
    mockUltima = respuesta('r1', { destino: '/(tabs)/activity' });
    const ir = jest.fn();
    atenderRespuestaDeArranque(ir);
    atenderRespuestaDeArranque(ir); // re-render / vuelta de background
    expect(ir).toHaveBeenCalledTimes(1);
    expect(ir).toHaveBeenCalledWith('/(tabs)/activity');
  });

  it('una respuesta nueva con otro identifier sí navega', () => {
    const ir = jest.fn();
    mockUltima = respuesta('r1', { destino: '/a' });
    atenderRespuestaDeArranque(ir);
    mockUltima = respuesta('r2', { destino: '/b' });
    atenderRespuestaDeArranque(ir);
    expect(ir).toHaveBeenCalledTimes(2);
  });

  it('sin destino no navega', () => {
    mockUltima = respuesta('r1', {});
    const ir = jest.fn();
    atenderRespuestaDeArranque(ir);
    expect(ir).not.toHaveBeenCalled();
  });

  it('sin respuesta pendiente no navega', () => {
    const ir = jest.fn();
    atenderRespuestaDeArranque(ir);
    expect(ir).not.toHaveBeenCalled();
  });

  it('un tap ya atendido por el mockListener no se repite desde el arranque', () => {
    const ir = jest.fn();
    onNotificationTap(ir);
    const r = respuesta('r1', { destino: '/(tabs)/activity' });
    mockListener!(r);
    mockUltima = r;
    atenderRespuestaDeArranque(ir);
    expect(ir).toHaveBeenCalledTimes(1);
  });
});
