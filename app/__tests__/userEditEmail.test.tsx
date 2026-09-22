import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import UserScreen from '@/app/(tabs)/user';
import { useAuthStore } from '@/src/store/authStore';
import type { User } from '@/src/types/models';

/**
 * PO 2026-09-22: un solo botón/hoja edita nombre Y email juntos.
 *
 * El email es editable para Apple (y para invitados): Apple sólo lo manda en
 * el primer login de cada Apple ID, y nunca si el usuario elige "Ocultar mi
 * correo" — sin poder editarlo a mano, esa persona queda para siempre sin
 * verlo ni completarlo en la app.
 *
 * Para Google NO es editable: ese email es el de la cuenta con la que se
 * entra, y editarlo acá lo desincroniza sin arreglar nada.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const APPLE_USER = {
  id: 'apple:000123',
  name: 'Gabriel',
  email: '',
  authProvider: 'apple',
  createdAt: 0,
  updatedAt: 0,
  isDeleted: false,
} as User;

const GOOGLE_USER = {
  id: 'google:456',
  name: 'Gabriel',
  email: 'gab.maglia@gmail.com',
  authProvider: 'google',
  createdAt: 0,
  updatedAt: 0,
  isDeleted: false,
} as User;

describe('editar nombre y email desde "Yo" (T-137-bis)', () => {
  describe('Apple: el email es editable', () => {
    beforeEach(() => {
      useAuthStore.setState({ currentUser: { ...APPLE_USER } });
    });

    it('sin email guardado, la fila invita a agregarlo', () => {
      const r = render(<UserScreen />);
      expect(r.getByText('profile.no_email')).toBeTruthy();
    });

    it('el botón de editar abre una sola hoja con nombre y email', () => {
      useAuthStore.setState({ currentUser: { ...APPLE_USER, email: 'gab@icloud.com' } });
      const r = render(<UserScreen />);

      fireEvent.press(r.getByTestId('edit-profile-btn'));

      expect(r.getByDisplayValue('Gabriel')).toBeTruthy();
      expect(r.getByDisplayValue('gab@icloud.com')).toBeTruthy();
    });

    it('un email con forma inválida deja el guardado deshabilitado', () => {
      const r = render(<UserScreen />);
      fireEvent.press(r.getByTestId('edit-profile-btn'));

      fireEvent.changeText(r.getByPlaceholderText('profile.edit_email_placeholder'), 'no-es-un-email');
      fireEvent.press(r.getByText('common.save'));

      expect(useAuthStore.getState().currentUser?.email).toBe('');
    });

    it('guarda nombre y email juntos, en un solo toque', () => {
      const r = render(<UserScreen />);
      fireEvent.press(r.getByTestId('edit-profile-btn'));

      fireEvent.changeText(r.getByPlaceholderText('profile.edit_name_placeholder'), 'Gabriel M.');
      fireEvent.changeText(r.getByPlaceholderText('profile.edit_email_placeholder'), 'gab@icloud.com');
      fireEvent.press(r.getByText('common.save'));

      expect(useAuthStore.getState().currentUser?.name).toBe('Gabriel M.');
      expect(useAuthStore.getState().currentUser?.email).toBe('gab@icloud.com');
    });

    it('el email es opcional: se puede guardar el nombre dejándolo vacío', () => {
      useAuthStore.setState({ currentUser: { ...APPLE_USER, email: 'gab@icloud.com' } });
      const r = render(<UserScreen />);
      fireEvent.press(r.getByTestId('edit-profile-btn'));

      fireEvent.changeText(r.getByPlaceholderText('profile.edit_email_placeholder'), '');
      fireEvent.press(r.getByText('common.save'));

      expect(useAuthStore.getState().currentUser?.email).toBe('');
    });
  });

  describe('Google: el email NO es editable', () => {
    beforeEach(() => {
      useAuthStore.setState({ currentUser: { ...GOOGLE_USER } });
    });

    it('la hoja muestra el email de la cuenta de Google sin un input editable', () => {
      const r = render(<UserScreen />);
      fireEvent.press(r.getByTestId('edit-profile-btn'));

      expect(r.getByTestId('email-readonly')).toBeTruthy();
      expect(r.queryByPlaceholderText('profile.edit_email_placeholder')).toBeNull();
    });

    it('guardar sólo cambia el nombre; el email de Google queda intacto', () => {
      const r = render(<UserScreen />);
      fireEvent.press(r.getByTestId('edit-profile-btn'));

      fireEvent.changeText(r.getByPlaceholderText('profile.edit_name_placeholder'), 'Gabriel M.');
      fireEvent.press(r.getByText('common.save'));

      expect(useAuthStore.getState().currentUser?.name).toBe('Gabriel M.');
      expect(useAuthStore.getState().currentUser?.email).toBe('gab.maglia@gmail.com');
    });
  });
});
