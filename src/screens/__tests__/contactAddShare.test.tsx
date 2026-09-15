import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Share } from 'react-native';
import AddContactScreen from '@/app/contact/add';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { listContactInvites } from '@/src/store/identityStore';
import { parseContactInviteLink } from '@/src/sync/contactInvite';
import type { User } from '@/src/types/models';

/**
 * C1 (revisión final de T-096 · ADR-015): `createContactInvite` armaba la
 * invitación pero nada la persistía — `saveContactInvite` no tenía ningún
 * llamador de producción, sólo tests que lo llamaban a mano para simular el
 * paso que faltaba. El link de "Compartir" nunca completaba: la invitación no
 * quedaba en el storage de quien comparte, así que `activeContactInvites`/
 * `processAllContactInvites` nunca la procesaban de ESE lado — ni un reclamo
 * legítimo podía admitirse.
 *
 * Este test NO llama a `saveContactInvite` a mano: ejercita el camino real —
 * tocar "Compartir" en la pantalla — y verifica que la invitación quede
 * realmente en `listContactInvites()`, con el mismo token del link compartido.
 * `identityStore` y `contactChannel` NO se mockean acá a propósito: la
 * persistencia tiene que ser la real, con el storage en memoria del harness.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-native-qrcode-svg', () => () => null);
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));
jest.mock('@/src/sync/relayEngine', () => ({ deviceId: () => 'dev-1' }));

const ANA = { id: 'ana1', name: 'Ana', isDeleted: false } as User;

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [ANA] });
});

describe('compartir link de contacto — persistencia real (C1)', () => {
  it('tocar "Compartir" deja la invitación en listContactInvites(), con el mismo token del link', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
    const r = render(<AddContactScreen />);

    await act(async () => { fireEvent.press(r.getByTestId('contact-share-link')); });

    expect(share).toHaveBeenCalledTimes(1);
    const mensaje = share.mock.calls[0][0].message as string;
    // El mock global de i18next (`src/test-utils/setup.ts`) devuelve
    // `clave({"link":"https://…"})`: el link va entre comillas dentro del JSON.
    const linkMatch = mensaje.match(/https:\/\/[^"\s]+/);
    expect(linkMatch).toBeTruthy();

    const parsed = parseContactInviteLink(linkMatch![0]);
    expect(parsed).not.toBeNull();

    const persistidas = listContactInvites();
    expect(persistidas.map(i => i.token)).toContain(parsed!.token);
  });

  it('cada toque de "Compartir" persiste su propia invitación (no una fantasma de un render viejo)', async () => {
    jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
    const r = render(<AddContactScreen />);

    await act(async () => { fireEvent.press(r.getByTestId('contact-share-link')); });
    const primero = listContactInvites().length;
    expect(primero).toBeGreaterThan(0);

    // Un re-render SIN volver a tocar "Compartir" no debe minar una invitación nueva
    // (I2): antes, `deepLink` se recalculaba en cada render del componente.
    r.rerender(<AddContactScreen />);
    expect(listContactInvites().length).toBe(primero);
  });
});
