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
  hasConflictingPinnedKeys: jest.fn(() => false),
}));
jest.mock('@/src/store/identityStore', () => ({
  ensureIdentity: () => ({ publicKey: 'id-pub' }),
  ensureWrapKeypair: () => ({ publicKey: 'wrap-pub' }),
}));
jest.mock('@/src/sync/relayEngine', () => ({ deviceId: () => 'dev-1' }));

const ANA  = { id: 'ana',  name: 'Ana',  isDeleted: false } as User;
const BETO = { id: 'beto', name: 'Beto', isDeleted: false } as User;

// T-098 · SEC L-2 (ronda 2): el formato largo ahora exige hex de 32 bytes en
// s/w/k. Cada una distinta de las demás — los tests de conflicto de T-093
// comparan valores concretos (la "pinneada" contra la "del atacante").
const SEC             = 'a1'.repeat(32);
const WRAP            = 'b2'.repeat(32);
const IDK             = 'c3'.repeat(32);
const IDK_NUEVA       = 'd4'.repeat(32);
const SEC_ATACANTE    = 'e5'.repeat(32);
const WRAP_ATACANTE   = 'f6'.repeat(32);
const IDK_ATACANTE    = '07'.repeat(32);

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

  // T-093 / SEC H-1: el criterio 2 es "por link NI por QR" — el escaneo presencial sigue
  // siendo de un paso, pero si las claves no coinciden con lo pinneado, tampoco se pisa acá.
  it('claves distintas a las pinneadas: el QR tampoco pisa, avisa y no persiste', () => {
    const { hasConflictingPinnedKeys, savePeer, announceContact } = jest.requireMock('@/src/sync/contactChannel');
    (hasConflictingPinnedKeys as jest.Mock).mockReturnValueOnce(true);

    escanearCodigo(CON_SECRETO);

    expect(useUserStore.getState().users.map(u => u.id)).not.toContain('beto');
    expect(savePeer).not.toHaveBeenCalled();
    expect(announceContact).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('contact.keys_changed_title', expect.stringContaining('contact.keys_changed_body'), expect.any(Array));
  });
});

describe('agregar contacto por LINK', () => {
  /**
   * Antes el link lo procesaba `_layout.tsx` en silencio, y la pantalla se abría mostrando
   * el QR PROPIO, sin ningún aviso. Ahora el link hace exactamente lo que el escaneo.
   *
   * **T-093 / SEC H-1:** un link (a diferencia del QR) puede llegar de cualquiera, sin que
   * haya habido ningún encuentro presencial. Por eso ya NO agrega solo: primero muestra una
   * confirmación (nombre + huella de la clave) y recién con el toque de «Agregar» persiste
   * algo. Cancelar/cerrar la hoja no debe escribir nada ni llamar a `announceContact`.
   */
  it('abrir el link NO agrega nada todavía: muestra la confirmación primero', () => {
    mockParams = { id: 'beto', name: 'Beto', s: SEC, w: WRAP, k: IDK };
    const r = render(<AddContactScreen />);

    expect(useUserStore.getState().users.map(u => u.id)).not.toContain('beto');
    expect(router.back).not.toHaveBeenCalled();
    const { announceContact, savePeer } = jest.requireMock('@/src/sync/contactChannel');
    expect(announceContact).not.toHaveBeenCalled();
    expect(savePeer).not.toHaveBeenCalled();
    expect(r.getByTestId('contact-confirm-add')).toBeTruthy();
  });

  it('confirmar en la hoja agrega, cierra la pantalla y avisa — igual que escanear', () => {
    mockParams = { id: 'beto', name: 'Beto', s: SEC, w: WRAP, k: IDK };
    const r = render(<AddContactScreen />);

    fireEvent.press(r.getByTestId('contact-confirm-add'));

    expect(useUserStore.getState().users.map(u => u.id)).toContain('beto');
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith('contact.added_title', expect.stringContaining('contact.added_both_body'), expect.any(Array));
  });

  it('cancelar la confirmación no persiste nada y no llama al relay', () => {
    mockParams = { id: 'beto', name: 'Beto', s: SEC, w: WRAP, k: IDK };
    const r = render(<AddContactScreen />);

    fireEvent.press(r.getByTestId('contact-confirm-cancel'));

    expect(useUserStore.getState().users.map(u => u.id)).not.toContain('beto');
    const { announceContact, savePeer } = jest.requireMock('@/src/sync/contactChannel');
    expect(announceContact).not.toHaveBeenCalled();
    expect(savePeer).not.toHaveBeenCalled();
  });

  it('el link guarda las TRES claves del contacto, no sólo el secreto, recién al confirmar', () => {
    const { savePeer } = jest.requireMock('@/src/sync/contactChannel');
    mockParams = { id: 'beto', name: 'Beto', s: SEC, w: WRAP, k: IDK };
    const r = render(<AddContactScreen />);
    fireEvent.press(r.getByTestId('contact-confirm-add'));

    expect(savePeer).toHaveBeenCalledWith('beto', { secret: SEC, wrapPublicKey: WRAP, identityPublicKey: IDK });
  });

  it('el link COMPACTO (?c=) agrega igual tras confirmar, con las tres claves', () => {
    const { savePeer } = jest.requireMock('@/src/sync/contactChannel');
    const h = (b: string) => b.repeat(32);
    mockParams = { c: codificarContacto({ id: '112233445566778899001', name: 'Beto', secret: h('ab'), wrapPublicKey: h('cd'), identityPublicKey: h('ef') })! };
    const r = render(<AddContactScreen />);
    fireEvent.press(r.getByTestId('contact-confirm-add'));

    expect(useUserStore.getState().users.map(u => u.id)).toContain('112233445566778899001');
    expect(savePeer).toHaveBeenCalledWith('112233445566778899001', { secret: h('ab'), wrapPublicKey: h('cd'), identityPublicKey: h('ef') });
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('un re-render no vuelve a procesar el link (no duplica la confirmación)', () => {
    mockParams = { id: 'beto', name: 'Beto', s: SEC };
    const r = render(<AddContactScreen />);
    r.rerender(<AddContactScreen />);

    expect(r.getAllByTestId('contact-confirm-add')).toHaveLength(1);
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

  // T-093 / SEC H-1: si el id del link ya tiene una clave pinneada distinta —
  // incluso de un contacto borrado (tombstone)— no se persiste nada, ni por
  // link ni por QR. Se avisa y se corta antes de mostrar la confirmación.
  it('claves distintas a las pinneadas: no persiste, avisa, y ni siquiera llega a mostrar la confirmación', () => {
    const { hasConflictingPinnedKeys, savePeer, announceContact } = jest.requireMock('@/src/sync/contactChannel');
    (hasConflictingPinnedKeys as jest.Mock).mockReturnValueOnce(true);
    mockParams = { id: 'beto', name: 'Beto', s: SEC, w: WRAP, k: IDK_NUEVA };
    const r = render(<AddContactScreen />);

    expect(useUserStore.getState().users.map(u => u.id)).not.toContain('beto');
    expect(savePeer).not.toHaveBeenCalled();
    expect(announceContact).not.toHaveBeenCalled();
    expect(r.queryByTestId('contact-confirm-add')).toBeNull();
    expect(Alert.alert).toHaveBeenCalledWith('contact.keys_changed_title', expect.stringContaining('contact.keys_changed_body'), expect.any(Array));
  });

  // T-093 RONDA 2 / R-1 (verificador ciego): `hasConflictingPinnedKeys` se evaluaba
  // sólo al abrir el link. Si entre que se abre la hoja y se toca «Agregar» llega la
  // tarjeta REAL del contacto por el drenado en tiempo real (`relayEngine` →
  // `drainContacts` → `savePeerFromCard`, que SÍ pinnea porque no había previo), el
  // toque de confirmar pisaba esas claves recién pinneadas con las del link.
  it('carrera: si las claves se pinnean recién DESPUÉS de abrir el link, confirmar no persiste ni pisa', () => {
    const { hasConflictingPinnedKeys, savePeer, announceContact } = jest.requireMock('@/src/sync/contactChannel');
    // Al abrir el link no hay nadie pinneado todavía: sin conflicto.
    (hasConflictingPinnedKeys as jest.Mock).mockReturnValueOnce(false);
    mockParams = { id: 'beto', name: 'Beto', s: SEC_ATACANTE, w: WRAP_ATACANTE, k: IDK_ATACANTE };
    const r = render(<AddContactScreen />);
    expect(r.getByTestId('contact-confirm-add')).toBeTruthy();

    // Mientras la hoja sigue abierta, llega la tarjeta real de Beto y pinnea SUS
    // claves reales: la próxima consulta (recién antes de escribir) tiene que verlo.
    (hasConflictingPinnedKeys as jest.Mock).mockReturnValueOnce(true);
    fireEvent.press(r.getByTestId('contact-confirm-add'));

    expect(useUserStore.getState().users.map(u => u.id)).not.toContain('beto');
    expect(savePeer).not.toHaveBeenCalled();
    expect(announceContact).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('contact.keys_changed_title', expect.stringContaining('contact.keys_changed_body'), expect.any(Array));
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
