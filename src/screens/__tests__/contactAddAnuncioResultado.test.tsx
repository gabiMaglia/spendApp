import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import AddContactScreen from '@/app/contact/add';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { buildContactPayload } from '@/src/utils/contactLink';
import type { User } from '@/src/types/models';

/**
 * BUG «contacto por QR queda de un solo lado» — causa real (engram/qa/BUG-qr-contacto.md,
 * hipótesis 2): `add.tsx` mostraba SIEMPRE `added_both_body` con un código con secreto,
 * sin mirar si `announceContact` (el envío al buzón del otro) salió bien. Con la build del
 * escaneador sin `EXPO_PUBLIC_SUPABASE_*` (`isRelayConfigured()` false) o sin red al
 * momento del QR, `announceContact` devuelve `false` y el otro aparato nunca se entera —
 * pero el cartel decía "quedaron conectados los dos".
 *
 * Tabla de estados (retro PO 2026-09-26):
 *  1. Update desde versión publicada     → sin cambio de formato persistido, no aplica acá
 *     (`tarjetasEnviadas`/peers no cambian de forma; ver `anunciarMiTarjeta.test.ts`, sin tocar).
 *  2. Invitado/cuenta                     → `persistirContacto` no rama por `authProvider`
 *     (siempre guarda `'google'`); el mensaje depende sólo del resultado de red, cubierto
 *     por los tests de abajo sin importar quién escanea.
 *  3. Build sin relay configurado         → `announceContact` devuelve `false` (mismo código
 *     que "sin red"); además ya existe el aviso persistente `SyncNoDisponible` (T-099, "Yo").
 *  4. Relay configurado, sin red al QR    → `announceContact` devuelve `false`; el reintento
 *     ya existe en `anunciarMiTarjeta` (relayEngine, corre en cada sync) — no queda a medias
 *     para siempre porque nunca se llama `marcarCardEnviada` para ese peer.
 *  5. Relay OK                            → `announceContact` devuelve `true`, cartel mutuo.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-qrcode-svg', () => () => null);

let escanear: ((e: { data: string }) => void) | undefined;
jest.mock('expo-camera', () => ({
  CameraView: (props: { onBarcodeScanned?: (e: { data: string }) => void }) => {
    escanear = props.onBarcodeScanned;
    return null;
  },
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));

const mockAnnounce = jest.fn();
jest.mock('@/src/sync/contactChannel', () => ({
  ensureContactSecret: () => 'mi-secreto',
  announceContact: (...a: unknown[]) => mockAnnounce(...a),
  savePeer: jest.fn(),
  hasConflictingPinnedKeys: jest.fn(() => false),
}));
jest.mock('@/src/store/identityStore', () => ({
  ensureIdentity: () => ({ publicKey: 'aa'.repeat(32), privateKey: 'aa'.repeat(32) }),
  ensureWrapKeypair: () => ({ publicKey: 'bb'.repeat(32), privateKey: 'bb'.repeat(32) }),
  saveContactInvite: jest.fn(),
}));
jest.mock('@/src/sync/relayEngine', () => ({ deviceId: () => 'dev-1' }));

const ANA  = { id: 'ana1',  name: 'Ana',  isDeleted: false } as User;
const BETO = { id: 'beto1', name: 'Beto', isDeleted: false } as User;

const CON_SECRETO = buildContactPayload(BETO, { secret: 's', wrapPublicKey: 'w', identityPublicKey: 'i' });

beforeEach(() => {
  escanear = undefined;
  mockParams = {};
  jest.clearAllMocks();
  (router.canGoBack as jest.Mock).mockReturnValue(true);
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [ANA] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => { jest.restoreAllMocks(); });

function escanearCodigo(data: string) {
  const r = render(<AddContactScreen />);
  fireEvent.press(r.getByText('contact.tab_scan'));
  expect(escanear).toBeDefined();
  act(() => { escanear!({ data }); });
  return r;
}

describe('mensaje tras agregar por QR usa el resultado REAL de announceContact', () => {
  it('estado 3/4 — announceContact da false (sin relay configurado o sin red): mensaje honesto de una sola dirección, no "quedaron los dos"', async () => {
    mockAnnounce.mockResolvedValue(false);

    escanearCodigo(CON_SECRETO);
    // La pantalla cierra en el acto (no depende de la red), el cartel sí espera el resultado.
    expect(router.back).toHaveBeenCalledTimes(1);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(Alert.alert).toHaveBeenCalledWith(
      'contact.added_title',
      expect.stringContaining('contact.added_half_body'),
      expect.any(Array),
    );
    expect(Alert.alert).not.toHaveBeenCalledWith(
      'contact.added_title',
      expect.stringContaining('contact.added_both_body'),
      expect.any(Array),
    );
  });

  it('estado 5 — announceContact da true: mensaje mutuo real, no supuesto', async () => {
    mockAnnounce.mockResolvedValue(true);

    escanearCodigo(CON_SECRETO);
    expect(router.back).toHaveBeenCalledTimes(1);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(Alert.alert).toHaveBeenCalledWith(
      'contact.added_title',
      expect.stringContaining('contact.added_both_body'),
      expect.any(Array),
    );
  });

  it('un contacto agregado con anuncio fallido NO queda marcado como enviado — el reintento de `anunciarMiTarjeta` lo toma después (T-138-bis)', async () => {
    mockAnnounce.mockResolvedValue(false);
    escanearCodigo(CON_SECRETO);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // `marcarCardEnviada` vive en relayEngine, no en add.tsx: este screen NUNCA debe
    // llamarlo directamente, porque eso es lo que haría que el reintento automático
    // (que sólo reenvía a quien NO tiene la huella marcada) dejara de intentarlo.
    const contactChannel = jest.requireMock('@/src/sync/contactChannel');
    expect(contactChannel.marcarCardEnviada).toBeUndefined();
  });
});
