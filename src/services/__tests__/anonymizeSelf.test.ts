import { anonymizeSelf } from '../anonymizeSelf';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import type { User } from '@/src/types/models';

jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', anunciarMiTarjeta: jest.fn(),
}));

/**
 * T-074 D-1. Al borrar la cuenta, los peers dejan de ver el nombre y la foto —
 * pero **los importes no se tocan**: son la prueba de deudas de otras personas
 * y borrarlos les rompería las cuentas a gente que no pidió nada.
 *
 * Es lo mismo que hacen WhatsApp y Splitwise: la persona desaparece de la
 * presentación, sus datos compartidos se quedan.
 */
const YO: User = {
  id: 'u1', name: 'Gabriel', email: 'g@x.com', avatar: 'data:image/jpeg;base64,AAAA',
  avatarUrl: 'https://cdn/x.jpg', authProvider: 'google', createdAt: 1, updatedAt: 1, isDeleted: false,
};
const OTRO: User = {
  id: 'u2', name: 'Ana', email: 'a@x.com', avatar: 'data:image/jpeg;base64,BBBB',
  authProvider: 'apple', createdAt: 1, updatedAt: 1, isDeleted: false,
};

beforeEach(() => {
  useAuthStore.setState({ currentUser: YO });
  useUserStore.setState({ users: [YO, OTRO] });
});

describe('anonimizar el propio perfil', () => {
  /**
   * **`null`, no `undefined`, y ésa es toda la gracia.**
   *
   * `preservarAvatar` (T-056) conserva la foto que había cuando la que llega
   * viene ausente — sin eso, una tarjeta de contacto sin foto le borraba la foto
   * a todo el grupo. Así que quitársela de verdad exige el tombstone explícito
   * que `src/store/userAvatar.ts` dejó previsto. Si alguien "simplifica" esto a
   * un `delete`, la foto vuelve y el borrado de cuenta queda a medias.
   */
  it('pone el tombstone de foto, y no simplemente la saca', () => {
    anonymizeSelf('Cuenta borrada');

    const yo = useUserStore.getState().getUserById('u1')!;
    expect(yo.name).toBe('Cuenta borrada');
    expect(yo.avatar).toBeNull();
    expect(yo.avatarUrl).toBeUndefined();
  });

  it('la foto no vuelve si el registro se re-mergea sobre el previo', () => {
    // El camino real: el peer aplica el registro anónimo sobre el que tenía CON
    // foto. Es exactamente donde la regla de T-056 la resucitaba.
    anonymizeSelf('Cuenta borrada');
    const anonimo = useUserStore.getState().getUserById('u1')!;

    useUserStore.setState({ users: [YO, OTRO] });          // el peer, con la foto
    useUserStore.getState().mergeUsers([anonimo]);

    expect(useUserStore.getState().getUserById('u1')!.avatar).toBeNull();
  });

  it('sube el `updatedAt` — si no, el merge LWW del peer lo descarta', () => {
    anonymizeSelf('Cuenta borrada');
    expect(useUserStore.getState().getUserById('u1')!.updatedAt).toBeGreaterThan(YO.updatedAt);
  });

  it('deja la sesión coherente con el store', () => {
    anonymizeSelf('Cuenta borrada');
    expect(useAuthStore.getState().currentUser?.name).toBe('Cuenta borrada');
    expect(useAuthStore.getState().currentUser?.avatar).toBeNull();
  });

  it('NO toca a ningún otro usuario', () => {
    anonymizeSelf('Cuenta borrada');
    expect(useUserStore.getState().getUserById('u2')).toEqual(OTRO);
  });

  it('NO toca ni un gasto: los importes son deudas de otros', () => {
    const gastos = useExpenseStore.getState().expenses;
    const antes = JSON.stringify(gastos);
    anonymizeSelf('Cuenta borrada');
    expect(JSON.stringify(useExpenseStore.getState().expenses)).toBe(antes);
  });

  it('sin sesión es un no-op y no lanza', () => {
    useAuthStore.setState({ currentUser: null });
    expect(() => anonymizeSelf('Cuenta borrada')).not.toThrow();
    expect(useUserStore.getState().getUserById('u1')).toEqual(YO);
  });
});
