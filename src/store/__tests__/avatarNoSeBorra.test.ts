import { preservarAvatar } from '@/src/store/userAvatar';
import { useUserStore } from '@/src/store/userStore';
import { canonical } from '@/src/store/lww';
import { applyDelta, type SyncDelta } from '@/src/sync/useSyncQR';
import type { User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

/**
 * **La foto no la borra nadie más que su dueño** (T-056).
 *
 * `mergeByIdLWW` reemplaza el registro entero, así que un `User` que llega sin
 * foto se lleva puesta la que había. No es teórico: `contactChannel` escribe la
 * tarjeta recibida con `updatedAt` nuevo, y una tarjeta sin foto gana siempre.
 *
 * Y en EMPATE es peor todavía: el desempate es por `canonical` mayor, y la
 * clave `"avatar"` ordena antes que `"createdAt"` ⇒ el registro sin foto es el
 * canónico mayor ⇒ **gana justo el que borra**.
 *
 * Se puede sostener porque la app no tiene forma de quitarse la foto: `user.tsx`
 * sólo la reemplaza por otra. No hay borrado legítimo que esta regla rompa.
 */

const FOTO = 'data:image/jpeg;base64,AAAA';
const OTRA = 'data:image/jpeg;base64,BBBB';

const usuario = (over: Partial<User>): User => ({
  id: 'ana', name: 'Ana', email: 'ana@x.com', authProvider: 'google',
  createdAt: 0, updatedAt: 1_000, isDeleted: false, ...over,
});

beforeEach(() => useUserStore.setState({ users: [] }));

describe('preservarAvatar', () => {
  it('el entrante sin foto NO borra la que había', () => {
    const r = preservarAvatar(usuario({ avatar: FOTO }), usuario({ name: 'Ana G' }));
    expect(r.avatar).toBe(FOTO);
    expect(r.name).toBe('Ana G'); // lo demás sí se actualiza
  });

  it('el entrante CON foto pisa la anterior: cambiarse la foto tiene que funcionar', () => {
    const r = preservarAvatar(usuario({ avatar: FOTO }), usuario({ avatar: OTRA }));
    expect(r.avatar).toBe(OTRA);
  });

  it('sin registro previo, el entrante pasa tal cual', () => {
    expect(preservarAvatar(undefined, usuario({ avatar: FOTO })).avatar).toBe(FOTO);
    expect(preservarAvatar(undefined, usuario({})).avatar).toBeUndefined();
  });

  it('si el previo tampoco tenía foto, no se inventa ninguna', () => {
    expect(preservarAvatar(usuario({}), usuario({})).avatar).toBeUndefined();
  });
});

describe('el desempate de LWW favorece al que borra', () => {
  it('el canónico SIN foto es mayor que el canónico CON foto', () => {
    // Documenta por qué la regla hace falta también en empate, no sólo cuando
    // el entrante es más nuevo.
    expect(canonical(usuario({})) > canonical(usuario({ avatar: FOTO }))).toBe(true);
  });
});

describe('mergeUsers', () => {
  it('un entrante MÁS NUEVO sin foto no borra la foto local', () => {
    useUserStore.setState({ users: [usuario({ avatar: FOTO, updatedAt: 1_000 })] });
    useUserStore.getState().mergeUsers([usuario({ name: 'Ana G', updatedAt: 9_000 })]);

    const ana = useUserStore.getState().getUserById('ana')!;
    expect(ana.avatar).toBe(FOTO);
    expect(ana.name).toBe('Ana G');
  });

  it('en EMPATE de updatedAt tampoco la borra', () => {
    useUserStore.setState({ users: [usuario({ avatar: FOTO, updatedAt: 1_000 })] });
    useUserStore.getState().mergeUsers([usuario({ updatedAt: 1_000 })]);
    expect(useUserStore.getState().getUserById('ana')!.avatar).toBe(FOTO);
  });

  it('una foto NUEVA sí gana', () => {
    useUserStore.setState({ users: [usuario({ avatar: FOTO, updatedAt: 1_000 })] });
    useUserStore.getState().mergeUsers([usuario({ avatar: OTRA, updatedAt: 9_000 })]);
    expect(useUserStore.getState().getUserById('ana')!.avatar).toBe(OTRA);
  });

  it('no le pone foto a quien nunca la tuvo', () => {
    useUserStore.setState({ users: [usuario({ updatedAt: 1_000 })] });
    useUserStore.getState().mergeUsers([usuario({ updatedAt: 9_000 })]);
    expect(useUserStore.getState().getUserById('ana')!.avatar).toBeUndefined();
  });

  it('un usuario que no estaba entra igual', () => {
    useUserStore.getState().mergeUsers([usuario({ id: 'beto', avatar: OTRA })]);
    expect(useUserStore.getState().getUserById('beto')!.avatar).toBe(OTRA);
  });
});

describe('addOrUpdateUser', () => {
  /**
   * El caso real de `contactChannel.ts:322-332`: la tarjeta recibida se escribe
   * con `avatar: msg.avatar` y `updatedAt` nuevo. Con `msg.avatar` undefined el
   * spread `{...u, ...user}` mete el undefined y borra la foto.
   */
  it('una tarjeta sin foto no borra la foto que ya teníamos', () => {
    useUserStore.setState({ users: [usuario({ avatar: FOTO, updatedAt: 1_000 })] });
    useUserStore.getState().addOrUpdateUser(
      usuario({ name: 'Ana G', avatar: undefined, updatedAt: 9_000 }),
    );

    const ana = useUserStore.getState().getUserById('ana')!;
    expect(ana.avatar).toBe(FOTO);
    expect(ana.name).toBe('Ana G');
  });

  it('elegir una foto nueva la guarda', () => {
    useUserStore.setState({ users: [usuario({ avatar: FOTO })] });
    useUserStore.getState().addOrUpdateUser(usuario({ avatar: OTRA }));
    expect(useUserStore.getState().getUserById('ana')!.avatar).toBe(OTRA);
  });
});

describe('por el camino real del sync', () => {
  it('un delta de un peer que no tiene mi foto no me la borra', () => {
    useUserStore.setState({ users: [usuario({ id: 'beto', avatar: FOTO, updatedAt: 1_000 })] });

    const delta: SyncDelta = {
      version: 1, fromUserId: 'carla', timestamp: 0,
      groups: [], expenses: [], payments: [],
      users: [usuario({ id: 'beto', name: 'Beto P', updatedAt: 9_000 })],
    };
    applyDelta(delta, 'ana');

    const beto = useUserStore.getState().getUserById('beto')!;
    expect(beto.avatar).toBe(FOTO);
    expect(beto.name).toBe('Beto P');
  });
});
