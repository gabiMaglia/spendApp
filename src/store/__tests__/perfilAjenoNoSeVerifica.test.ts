import { createSecureStorage } from '@/src/utils/secureStorage';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '../userStore';
import { anonymizeSelf } from '@/src/services/anonymizeSelf';
import i18n from '@/src/i18n';
import type { User } from '@/src/types/models';

/**
 * **Lo que hoy pasa con un perfil ajeno, y por qué está bien que pase** (T-091).
 *
 * Estos tests no arreglan nada: **fijan el comportamiento actual con su razón**,
 * para que el día que alguien lo cambie sea una decisión y no un accidente. El
 * ticket de firmarlos se auditó y se descartó — ver
 * `src/sync/__tests__/usersNoEstaFirmado.test.ts`.
 *
 * Y fijan la mitad que sí se hizo: **`deletedAt`**, que permite rotular una
 * cuenta borrada en el idioma del que MIRA en vez de en el del que se borró.
 */
const YO: User = { id: 'yo', name: 'Yo', email: '', authProvider: 'google', createdAt: 0, updatedAt: 1, isDeleted: false };
const otro = (over: Partial<User> = {}): User => ({
  id: 'beto', name: 'Beto', email: '', authProvider: 'google',
  createdAt: 0, updatedAt: 10, isDeleted: false, ...over,
});

beforeEach(() => {
  createSecureStorage('users').clearAll();
  useAuthStore.setState({ currentUser: YO });
  useUserStore.setState({ users: [YO, otro()] });
});

describe('el perfil ajeno entra sin verificar — el riesgo, declarado', () => {
  it('un nombre cualquiera se aplica si su `updatedAt` es mayor', () => {
    // Esto ES el agujero: cualquiera con la clave del grupo puede mandar esto.
    // Se acepta declarado — está acotado a miembros, es reversible, y no mueve
    // un centavo: los importes viven en registros que SÍ están firmados.
    useUserStore.getState().mergeUsers([otro({ name: 'Vandalizado', updatedAt: 99 })]);

    expect(useUserStore.getState().getUserName('beto')).toBe('Vandalizado');
  });

  it('pero el dueño lo revierte reescribiendo su nombre: gana por LWW', () => {
    useUserStore.getState().mergeUsers([otro({ name: 'Vandalizado', updatedAt: 99 })]);
    useUserStore.getState().mergeUsers([otro({ name: 'Beto', updatedAt: 100 })]);

    expect(useUserStore.getState().getUserName('beto')).toBe('Beto');
  });

  it('la foto local sobrevive a un entrante que no la trae (T-056)', () => {
    useUserStore.setState({ users: [YO, otro({ avatar: 'data:foto' })] });
    useUserStore.getState().mergeUsers([otro({ updatedAt: 99 })]);

    expect(useUserStore.getState().users.find(u => u.id === 'beto')!.avatar).toBe('data:foto');
  });

  it('pero `avatar: null` SÍ la borra: es el tombstone', () => {
    /**
     * **Mutación que este test tiene que tumbar:** tratar el `null` como
     * ausencia en `src/store/userAvatar.ts`. Es la línea que T-074 necesitó para
     * que borrar la cuenta se lleve la foto, y un refactor distraído la revierte
     * sin que nada más se queje.
     */
    useUserStore.setState({ users: [YO, otro({ avatar: 'data:foto' })] });
    useUserStore.getState().mergeUsers([otro({ avatar: null, updatedAt: 99 })]);

    expect(useUserStore.getState().users.find(u => u.id === 'beto')!.avatar).toBeNull();
  });
});

describe('`deletedAt` — el cartel en el idioma del que mira', () => {
  it('una cuenta borrada se rotula con la clave local, no con el nombre que llegó', () => {
    // El `name` viene resuelto en el idioma del que se borró. Con `deletedAt`,
    // cada teléfono escribe el suyo.
    useUserStore.getState().mergeUsers([
      otro({ name: 'Conta apagada', deletedAt: 50, updatedAt: 99 }),
    ]);

    // Se compara contra `i18n.t` y no contra un literal: lo que se fija es que
    // el rótulo salga del catálogo LOCAL, no del `name` que mandó el otro.
    expect(useUserStore.getState().getUserName('beto')).toBe(i18n.t('account_delete.anon_name'));
    expect(useUserStore.getState().getUserName('beto')).not.toBe('Conta apagada');
  });

  it('sin `deletedAt` se usa el nombre literal — el peer que no actualizó', () => {
    useUserStore.getState().mergeUsers([otro({ name: 'Conta apagada', updatedAt: 99 })]);

    expect(useUserStore.getState().getUserName('beto')).toBe('Conta apagada');
  });

  it('borrar la cuenta propia deja la fecha, no sólo el texto', () => {
    anonymizeSelf('Cuenta borrada');

    const yo = useUserStore.getState().users.find(u => u.id === 'yo')!;
    expect(typeof yo.deletedAt).toBe('number');
    expect(yo.avatar).toBeNull();
  });
});
