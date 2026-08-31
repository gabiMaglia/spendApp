import type { Notice } from '../syncNotices';
import type { User } from '@/src/types/models';

/**
 * T-054 · un módulo nativo NO puede estar en el camino del sync.
 *
 * El 30/08 la app dejó de abrir por esta misma forma: `expo-image-manipulator`
 * importado en el tope de `avatar.ts`, al que `contactChannel → relayEngine →
 * groupStore` alcanzaba. Como TODOS los stores cuelgan de esa cadena, un build
 * sin el binario no falla en la pantalla de la feature: falla en el arranque.
 *
 * `expo-notifications` estaba igual (`notifications.ts:1`). No se manifestaba
 * porque el nativo sí entra en el build de hoy — o sea que un test que mockea
 * el módulo NORMALMENTE nunca lo hubiera visto. Por eso acá se simula la
 * AUSENCIA: el `require` tira, como en un build donde el nativo no entró.
 *
 * Lo que se exige es la degradación: sin el módulo se pierden las
 * notificaciones y NADA más.
 */
const FALTA_NATIVO = "Cannot find native module 'ExpoNotifications'";

/** Deja el registro de módulos como un build SIN el nativo de notificaciones. */
function comoUnBuildSinElNativo(): void {
  jest.resetModules();
  jest.doMock('expo-notifications', () => {
    throw new Error(FALTA_NATIVO);
  });
}

const gastos: Notice = { kind: 'expenses', groupId: 'g1', groupName: 'Viaje', count: 2 };

afterEach(() => {
  jest.dontMock('expo-notifications');
  jest.resetModules();
});

describe('T-054 · build sin el módulo nativo de notificaciones', () => {
  it('el camino del sync se carga entero: groupStore → relayEngine → notifications', () => {
    comoUnBuildSinElNativo();

    // Con el import estático arriba de `notifications.ts`, este require tira y
    // en el device equivale a que la app no abra. Es LA aserción del ticket.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(() => require('@/src/sync/relayEngine')).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useGroupStore } = require('@/src/store/groupStore');

    // Cargar no alcanza: el store tiene que SERVIR. Sin esto, un módulo que se
    // importa y queda roto pasaría igual.
    useGroupStore.getState().addGroup({
      id: 'g-t054', name: 'Viaje', currency: 'ARS', memberIds: ['u1'],
      createdBy: 'u1', createdAt: 1, updatedAt: 1, isDeleted: false,
    });
    expect(useGroupStore.getState().getById('g-t054')?.name).toBe('Viaje');
  });

  it('installNotificationHandler no tira: corre a nivel de módulo en _layout', () => {
    // Se llama antes de cualquier render (`app/_layout.tsx`). Si tirara, la app
    // no llegaría ni a pintar la primera pantalla.
    comoUnBuildSinElNativo();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const notif = require('../notifications');
    expect(() => notif.installNotificationHandler()).not.toThrow();
  });

  it('announce deja el aviso en la bandeja y devuelve 0: se pierde el aviso, no el registro', async () => {
    comoUnBuildSinElNativo();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const notif = require('../notifications');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useNoticeInboxStore } = require('@/src/store/noticeInboxStore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSettingsStore } = require('@/src/store/settingsStore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAuthStore } = require('@/src/store/authStore');

    useAuthStore.setState({ currentUser: { id: 'u1' } as User });
    useNoticeInboxStore.getState().clear();
    useSettingsStore.setState({ notifExpenses: true });

    await expect(notif.announce([gastos])).resolves.toBe(0);
    expect(useNoticeInboxStore.getState().items).toHaveLength(1);
  });

  it('si el módulo está pero el registro del handler tira, tampoco tumba el arranque', () => {
    // Un nativo a medio enlazar carga y falla al usarse. Corre antes del primer
    // render: no puede tirar ni en ese caso.
    jest.resetModules();
    jest.doMock('expo-notifications', () => ({
      setNotificationHandler: () => { throw new Error('módulo a medio enlazar'); },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const notif = require('../notifications');
    expect(() => notif.installNotificationHandler()).not.toThrow();
  });

  it('sólo intenta cargar el nativo UNA vez por corrida', async () => {
    // Sin memoizar, cada aviso reintenta el require y en dev imprime otro error
    // rojo: dos avisos se leían como dos fallas distintas. Es la misma razón por
    // la que `avatar.ts` memoiza su manipulador.
    let intentos = 0;
    jest.resetModules();
    jest.doMock('expo-notifications', () => {
      intentos++;
      throw new Error(FALTA_NATIVO);
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const notif = require('../notifications');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSettingsStore } = require('@/src/store/settingsStore');
    useSettingsStore.setState({ notifExpenses: true });

    notif.installNotificationHandler();
    await notif.deliver([gastos]);

    expect(intentos).toBe(1);
  });

  it('deliver devuelve 0 sin tirar', async () => {
    comoUnBuildSinElNativo();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const notif = require('../notifications');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSettingsStore } = require('@/src/store/settingsStore');
    useSettingsStore.setState({ notifExpenses: true });

    await expect(notif.deliver([gastos])).resolves.toBe(0);
  });

  it('textFor sigue andando: la bandeja de avisos se pinta igual', () => {
    // `NoticeInboxSheet` lo usa para el texto de cada aviso ya registrado. Es
    // la parte del módulo que NO necesita el nativo, y la pantalla no puede
    // quedarse en blanco por un binario que no entró al build.
    comoUnBuildSinElNativo();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const notif = require('../notifications');
    expect(notif.textFor(gastos).title).toBe('Viaje');
  });

  it('ensurePermission dice que no, sin pedirle nada a nadie', async () => {
    // Sin el nativo no hay a quién pedirle el permiso. Tiene que devolver false
    // igual, y sin tirar: es lo que hace que `deliver` corte antes de entregar.
    comoUnBuildSinElNativo();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const notif = require('../notifications');
    await expect(notif.ensurePermission()).resolves.toBe(false);
  });
});
