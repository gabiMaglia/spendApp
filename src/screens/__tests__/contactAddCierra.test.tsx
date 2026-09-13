import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, Share } from 'react-native';
import { router } from 'expo-router';
import AddContactScreen from '@/app/contact/add';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { buildContactPayload } from '@/src/utils/contactLink';
import { codificarContacto } from '@/src/utils/linkCompacto';
import type { User } from '@/src/types/models';

/**
 * **Agregar un contacto por QR cierra la pantalla** (pedido del PO, 2026-09-12).
 *
 * Antes el alta mostraba un cartel y la pantalla se cerraba sólo al tocar «OK». En
 * Android, tocar fuera del cartel lo descarta SIN llamar a `onPress`: quedabas en la
 * cámara, con el escaneo trabado (`scanned` en true) y el contacto ya agregado.
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
jest.mock('@/src/sync/contactChannel', () => ({
  ensureContactSecret: () => 'mi-secreto',
  announceContact: jest.fn(() => Promise.resolve()),
  savePeer: jest.fn(),
}));
jest.mock('@/src/store/identityStore', () => ({
  ensureIdentity: () => ({ publicKey: 'id-pub' }),
  ensureWrapKeypair: () => ({ publicKey: 'wrap-pub' }),
}));
jest.mock('@/src/sync/relayEngine', () => ({ deviceId: () => 'dev-1' }));

const ANA  = { id: 'ana',  name: 'Ana',  isDeleted: false } as User;
const BETO = { id: 'beto', name: 'Beto', isDeleted: false } as User;

const CON_SECRETO = buildContactPayload(BETO, { secret: 's', wrapPublicKey: 'w', identityPublicKey: 'i' });
const SIN_SECRETO = buildContactPayload(BETO, null);

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

describe('agregar contacto por QR', () => {
  it('con un alta mutua, cierra la pantalla SIN esperar a que se toque el cartel', () => {
    escanearCodigo(CON_SECRETO);

    expect(useUserStore.getState().users.map(u => u.id)).toContain('beto');
    expect(router.back).toHaveBeenCalledTimes(1);
    // El cartel se muestra igual, pero ya no es él quien cierra.
    expect(Alert.alert).toHaveBeenCalledWith('contact.added_title', expect.stringContaining('contact.added_both_body'), expect.any(Array));
    const botones = (Alert.alert as jest.Mock).mock.calls[0][2] as { onPress?: () => void }[];
    botones.forEach(b => b.onPress?.());
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('con un alta de una sola dirección también cierra, y ofrece volver a mostrar mi código', () => {
    escanearCodigo(SIN_SECRETO);

    expect(router.back).toHaveBeenCalledTimes(1);
    const botones = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const mostrar = botones.find(b => b.text === 'contact.show_my_code');
    expect(mostrar).toBeDefined();
    mostrar!.onPress!();
    expect(router.push).toHaveBeenCalledWith('/contact/add');
  });

  it('si la pantalla se abrió sin historial (deep link), vuelve a Contactos en vez de quedarse', () => {
    (router.canGoBack as jest.Mock).mockReturnValue(false);
    escanearCodigo(CON_SECRETO);

    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/friends');
  });

  it('un QR que no es de la app NO cierra: deja reintentar', () => {
    escanearCodigo('https://example.com/cualquier-cosa');

    expect(router.back).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('contact.unknown_qr_title', 'contact.unknown_qr_body', expect.any(Array));
  });

  it('un contacto que ya existía no es un alta: no se cierra hasta que se acepta el cartel', () => {
    useUserStore.setState({ users: [ANA, BETO] });
    escanearCodigo(CON_SECRETO);

    expect(router.back).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('contact.already_title', expect.stringContaining('contact.already_body'), expect.any(Array));
  });
});

describe('agregar contacto por LINK', () => {
  /**
   * Antes el link lo procesaba `_layout.tsx` en silencio, y la pantalla se abría mostrando
   * el QR PROPIO, sin ningún aviso. Ahora el link hace exactamente lo que el escaneo.
   */
  it('abrir el link agrega, cierra la pantalla y avisa — igual que escanear', () => {
    mockParams = { id: 'beto', name: 'Beto', s: 'sec', w: 'wrap', k: 'idk' };
    render(<AddContactScreen />);

    expect(useUserStore.getState().users.map(u => u.id)).toContain('beto');
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith('contact.added_title', expect.stringContaining('contact.added_both_body'), expect.any(Array));
  });

  it('el link guarda las TRES claves del contacto, no sólo el secreto', () => {
    const { savePeer } = jest.requireMock('@/src/sync/contactChannel');
    mockParams = { id: 'beto', name: 'Beto', s: 'sec', w: 'wrap', k: 'idk' };
    render(<AddContactScreen />);

    expect(savePeer).toHaveBeenCalledWith('beto', { secret: 'sec', wrapPublicKey: 'wrap', identityPublicKey: 'idk' });
  });

  it('el link COMPACTO (?c=) agrega igual, con las tres claves', () => {
    const { savePeer } = jest.requireMock('@/src/sync/contactChannel');
    const h = (b: string) => b.repeat(32);
    mockParams = { c: codificarContacto({ id: '112233445566778899001', name: 'Beto', secret: h('ab'), wrapPublicKey: h('cd'), identityPublicKey: h('ef') })! };
    render(<AddContactScreen />);

    expect(useUserStore.getState().users.map(u => u.id)).toContain('112233445566778899001');
    expect(savePeer).toHaveBeenCalledWith('112233445566778899001', { secret: h('ab'), wrapPublicKey: h('cd'), identityPublicKey: h('ef') });
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('un re-render no vuelve a procesar el link', () => {
    mockParams = { id: 'beto', name: 'Beto', s: 'sec' };
    const r = render(<AddContactScreen />);
    r.rerender(<AddContactScreen />);

    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  it('mi propio link avisa con el texto del link, no el del QR, y vuelve a Contactos al aceptar', () => {
    mockParams = { id: 'ana', name: 'Ana' };
    render(<AddContactScreen />);

    expect(Alert.alert).toHaveBeenCalledWith('contact.own_qr_title', 'contact.own_link_body', expect.any(Array));
    const botones = (Alert.alert as jest.Mock).mock.calls[0][2] as { onPress?: () => void }[];
    botones[0].onPress!();
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('sin parámetros de contacto es la pantalla de siempre: no agrega ni avisa', () => {
    render(<AddContactScreen />);
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('compartir link de contacto', () => {
  /** El botón va abajo, flotante, como el resto de las botoneras del pie (PO, 2026-09-12). */
  it('en «Mi QR» está el botón flotante, y compartir manda el link', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
    const r = render(<AddContactScreen />);

    const boton = r.getByTestId('contact-share-link');
    await act(async () => { fireEvent.press(boton); });

    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0].message).toContain('https://spendapp.github.io/#c');
  });

  it('en «Escanear» no aparece: taparía la cámara', () => {
    const r = render(<AddContactScreen />);
    fireEvent.press(r.getByText('contact.tab_scan'));
    expect(r.queryByTestId('contact-share-link')).toBeNull();
  });
});
