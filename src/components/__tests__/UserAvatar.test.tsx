import React from 'react';
import { render } from '@testing-library/react-native';
import { UserAvatar } from '../UserAvatar';
import { useUserStore } from '@/src/store/userStore';
import { useAuthStore } from '@/src/store/authStore';
import type { User } from '@/src/types/models';

const FOTO = 'data:image/jpeg;base64,AAAA';
const u = (id: string, over: Partial<User> = {}): User =>
  ({ id, name: id, email: '', authProvider: 'google', createdAt: 0, updatedAt: 0, isDeleted: false, ...over } as User);

beforeEach(() => {
  useAuthStore.setState({ currentUser: u('yo', { name: 'Gabriel' }) });
  useUserStore.setState({ users: [] });
});

describe('UserAvatar', () => {
  it('sin foto muestra las iniciales', () => {
    useUserStore.setState({ users: [u('beto', { name: 'Beto Diaz' })] });
    const { getByText } = render(<UserAvatar userId="beto" />);
    expect(getByText('BD')).toBeTruthy();
  });

  it('con foto NO muestra iniciales', () => {
    useUserStore.setState({ users: [u('beto', { name: 'Beto Diaz', avatar: FOTO })] });
    const { queryByText } = render(<UserAvatar userId="beto" />);
    expect(queryByText('BD')).toBeNull();
  });

  it('para el usuario actual usa la foto de authStore', () => {
    // Justo despues de cambiarla, `authStore` la tiene y `userStore` puede
    // estar un paso atras: si se leyera solo del segundo, el usuario cambiaria
    // su foto y no la veria.
    useAuthStore.setState({ currentUser: u('yo', { name: 'Gabriel', avatar: FOTO }) });
    useUserStore.setState({ users: [u('yo', { name: 'Gabriel' })] });
    const { queryByText } = render(<UserAvatar userId="yo" />);
    expect(queryByText('G')).toBeNull();
  });

  it('un id desconocido no rompe: cae a "?"', () => {
    const { getByText } = render(<UserAvatar userId="fantasma" />);
    expect(getByText('?')).toBeTruthy();
  });

  it('el nombre que le pasan gana sobre la busqueda', () => {
    useUserStore.setState({ users: [u('beto', { name: 'Viejo Nombre' })] });
    const { getByText } = render(<UserAvatar userId="beto" name="Ana Ruiz" />);
    expect(getByText('AR')).toBeTruthy();
  });
});
