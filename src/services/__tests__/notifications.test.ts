import { deliver, isEnabled, textFor, resetPermissionCache } from '../notifications';
import { useSettingsStore } from '@/src/store/settingsStore';
import type { Notice } from '../syncNotices';

type Programada = { content: { title: string; body: string }; trigger: null };
const mockSchedule = jest.fn(async (_arg: Programada) => 'id');
const estado = { granted: true, pedidas: 0, explota: false };

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: async () => {
    if (estado.explota) throw new Error('sin modulo nativo');
    return { granted: estado.granted };
  },
  requestPermissionsAsync: async () => {
    estado.pedidas++;
    return { granted: estado.granted };
  },
  scheduleNotificationAsync: (arg: unknown) => mockSchedule(arg as Programada),
}));

const gastos: Notice = { kind: 'expenses', groupId: 'g1', groupName: 'Viaje', count: 2 };
const borrado: Notice = { kind: 'deletion', groupId: 'g1', groupName: 'Viaje', description: 'Pizza' };
const unido: Notice = { kind: 'joined', groupId: 'g1', groupName: 'Viaje' };

beforeEach(() => {
  mockSchedule.mockClear();
  mockSchedule.mockImplementation(async () => 'id');
  Object.assign(estado, { granted: true, pedidas: 0, explota: false });
  resetPermissionCache();
  useSettingsStore.setState({ notifExpenses: true, notifDeletions: true, notifInvites: true });
});

describe('preferencias', () => {
  it('cada tipo mira su propio toggle', () => {
    useSettingsStore.setState({ notifExpenses: false });
    expect(isEnabled(gastos)).toBe(false);
    expect(isEnabled(borrado)).toBe(true);
    expect(isEnabled(unido)).toBe(true);
  });

  it('no entrega lo que el usuario apagó', async () => {
    useSettingsStore.setState({ notifExpenses: false });
    expect(await deliver([gastos])).toBe(0);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('entrega sólo los tipos encendidos', async () => {
    useSettingsStore.setState({ notifDeletions: false });
    expect(await deliver([gastos, borrado, unido])).toBe(2);
  });
});

describe('permiso', () => {
  it('sin permiso no entrega nada', async () => {
    estado.granted = false;
    expect(await deliver([gastos])).toBe(0);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  /**
   * Preguntar por un aviso que el usuario ya apagó es pedir permiso para nada,
   * y una negativa en iOS cuesta ir a Ajustes del sistema para revertirla.
   */
  it('no pide permiso si no quedó ningún aviso para entregar', async () => {
    useSettingsStore.setState({ notifExpenses: false, notifDeletions: false, notifInvites: false });
    estado.granted = false;
    await deliver([gastos, borrado, unido]);
    expect(estado.pedidas).toBe(0);
  });

  it('se pide una sola vez aunque haya varias tandas', async () => {
    estado.granted = false;
    await deliver([gastos]);
    await deliver([borrado]);
    expect(estado.pedidas).toBe(1);
  });

  // Expo Go no trae el módulo nativo: tiene que degradarse, no tirar.
  it('sin módulo nativo no rompe', async () => {
    estado.explota = true;
    await expect(deliver([gastos])).resolves.toBe(0);
  });
});

describe('entrega', () => {
  it('manda una notificación por aviso', async () => {
    expect(await deliver([gastos, unido])).toBe(2);
  });

  // Un sync no se puede caer porque falló una notificación.
  it('una que falla no frena a las demás', async () => {
    mockSchedule.mockImplementation(async (arg: Programada) => {
      if (arg.content.title === 'Viaje') throw new Error('boom');
      return 'id';
    });
    await expect(deliver([gastos, { ...unido, groupName: 'Otro' }])).resolves.toBe(1);
  });

  it('una lista vacía no hace nada', async () => {
    expect(await deliver([])).toBe(0);
  });
});

describe('texto', () => {
  // Ningún string suelto: todo pasa por i18n. El mock de tests devuelve la clave.
  it('el grupo va en el título y el detalle en el cuerpo', () => {
    expect(textFor(gastos).title).toBe('Viaje');
    expect(textFor(gastos).body).toBeTruthy();
  });

  it('cada tipo tiene su propio texto', () => {
    const cuerpos = [gastos, borrado, unido].map(n => textFor(n).body);
    expect(new Set(cuerpos).size).toBe(3);
  });
});
