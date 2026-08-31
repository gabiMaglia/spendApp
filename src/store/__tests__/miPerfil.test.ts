import { actualizarMiPerfil } from '../miPerfil';
import { useAuthStore } from '../authStore';
import { useUserStore } from '../userStore';
import type { User } from '@/src/types/models';

const mockAnunciar = jest.fn();
jest.mock('@/src/sync/relayEngine', () => ({
  anunciarMiTarjeta: () => mockAnunciar(),
}));

const YO: User = {
  id: 'u1', name: 'Gabi', email: 'g@x.com', authProvider: 'google',
  createdAt: 0, updatedAt: 1_000, isDeleted: false,
};

beforeEach(() => {
  mockAnunciar.mockReset();
  useAuthStore.setState({ currentUser: { ...YO } });
  useUserStore.setState({ users: [{ ...YO }] });
});

describe('actualizarMiPerfil — los TRES pasos, siempre', () => {
  /**
   * El bug que originó esto: cambiar el NOMBRE hacía los tres pasos y cambiar
   * la FOTO sólo los dos primeros. A un contacto con el que no compartís
   * ningún grupo, la foto nueva le llegaba recién al próximo arranque.
   */
  it.each([
    ['la foto',   { avatar: 'data:image/jpeg;base64,AAAA' }],
    ['el nombre', { name: 'Gabriel' }],
  ])('cambiar %s anuncia la tarjeta de contacto', (_caso, cambios) => {
    actualizarMiPerfil(cambios);
    expect(mockAnunciar).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['la foto',   { avatar: 'data:image/jpeg;base64,AAAA' }, 'avatar'],
    ['el nombre', { name: 'Gabriel' }, 'name'],
  ])('cambiar %s escribe en authStore Y en userStore', (_caso, cambios, campo) => {
    actualizarMiPerfil(cambios);

    const enAuth = useAuthStore.getState().currentUser as unknown as Record<string, unknown>;
    const enLista = useUserStore.getState().users.find(u => u.id === 'u1') as unknown as Record<string, unknown>;
    // userStore es lo que leen las pantallas Y lo que arma el delta de sync:
    // escribir sólo authStore deja el dato viejo pegado hasta el próximo login.
    expect(enAuth[campo]).toEqual((cambios as Record<string, unknown>)[campo]);
    expect(enLista[campo]).toEqual((cambios as Record<string, unknown>)[campo]);
  });

  it('refresca updatedAt: sin eso el cambio no le gana a la versión del otro device', () => {
    const r = actualizarMiPerfil({ name: 'Gabriel' });
    expect(r!.updatedAt).toBeGreaterThan(YO.updatedAt);
  });

  it('sin sesión no escribe nada y devuelve null', () => {
    useAuthStore.setState({ currentUser: null });
    expect(actualizarMiPerfil({ name: 'X' })).toBeNull();
    expect(mockAnunciar).not.toHaveBeenCalled();
  });

  it('si el canal de contactos no está, el perfil se guarda igual', () => {
    // Degradar, no romper: el cambio llega igual por el delta a quien comparta
    // un grupo. Fallar acá perdería la edición del usuario por un problema de red.
    mockAnunciar.mockImplementation(() => { throw new Error('sin relay'); });
    const r = actualizarMiPerfil({ name: 'Gabriel' });
    expect(r!.name).toBe('Gabriel');
    expect(useUserStore.getState().users.find(u => u.id === 'u1')!.name).toBe('Gabriel');
  });
});
