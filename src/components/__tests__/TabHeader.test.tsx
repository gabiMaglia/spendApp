import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { fireEvent, render, renderHook } from '@testing-library/react-native';
import { TabHeader } from '../TabHeader';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';
import { registrarOferta } from '@/src/sync/groupKeyOffers';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { KeyConflictNotice } from '@/src/services/syncNotices';
import type { User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

/** Un data URI mínimo: alcanza para que `Avatar` dibuje una `<Image>`. */
const FOTO = 'data:image/png;base64,iVBORw0KGgo=';

const ANA = { id: 'ana', name: 'Ana' } as User;

function crearProgress(valor = 0) {
  return renderHook(() => useSharedValue(valor)).result.current;
}

function montar() {
  return render(<TabHeader title="Test" progress={crearProgress()} />);
}

beforeEach(() => {
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [ANA] });
  useGroupStore.setState({ groups: [] });
  useNoticeInboxStore.setState({ items: [] });
});

/**
 * **Un solo header para las seis tabs** (PO 2026-09-02).
 *
 * Antes cada tab lo armaba a mano y ninguna coincidía: el dashboard tenía
 * campana y moneda, Actividad ninguna de las dos, Perfil ni siquiera avatar.
 * La bandeja de avisos existía en UNA pantalla — enterarse de algo dependía de
 * en qué tab estabas parado.
 */
describe('el header trae siempre lo mismo', () => {
  it('el avatar muestra la FOTO de perfil cuando hay', () => {
    useAuthStore.setState({ currentUser: { ...ANA, avatar: FOTO } as User });

    const r = montar();
    expect(r.UNSAFE_getAllByType(require('react-native').Image).length).toBeGreaterThan(0);
  });

  // Sin foto no se rompe: cae a las iniciales, que es lo que había antes.
  it('sin foto cae a las iniciales', () => {
    const r = montar();
    expect(r.UNSAFE_queryAllByType(require('react-native').Image)).toHaveLength(0);
    expect(r.getByTestId('header-profile')).toBeTruthy();
  });

  it('el avatar lleva al perfil', () => {
    const { router } = require('expo-router');
    fireEvent.press(montar().getByTestId('header-profile'));
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('user'));
  });

  it('la campana abre la bandeja', () => {
    const r = montar();
    fireEvent.press(r.getByTestId('notice-bell'));
    expect(r.getByText('notifications.inbox_title')).toBeTruthy();
  });

  it('el selector de moneda abre la hoja de monedas', () => {
    const r = montar();
    // El chip del header dice sólo el código; la hoja lista símbolo + código.
    fireEvent.press(r.getByText('ARS'));
    expect(r.getAllByText(/USD/).length).toBeGreaterThan(0);
  });
});

/**
 * **T-119 (PO 2026-09-13): abrir la campana marca leídas las que NO piden
 * acción.** Las accionables (`deletion`, `settlement_pending`, `sync_down`)
 * siguen pendientes hasta resolverse — sólo mirarlas no alcanza.
 */
describe('abrir la campana marca leídas las que no piden acción (T-119)', () => {
  const SIN_ACCION = {
    id: 'n1', createdAt: 1, readAt: null,
    notice: { kind: 'expenses' as const, groupId: 'g1', groupName: 'Asado', count: 1 },
  };
  const CON_ACCION = {
    id: 'n2', createdAt: 2, readAt: null,
    notice: {
      kind: 'settlement_pending' as const, groupId: 'g1', groupName: 'Asado',
      paymentId: 'p1', amount: 500, currency: 'ARS' as const,
    },
  };

  beforeEach(() => {
    useNoticeInboxStore.setState({ items: [SIN_ACCION, CON_ACCION] });
  });

  it('el badge baja de 2 a 1 al abrir: sólo se marcó la que no pide acción', () => {
    const r = montar();
    expect(r.getAllByText('2').length).toBeGreaterThan(0);

    fireEvent.press(r.getByTestId('notice-bell'));

    expect(useNoticeInboxStore.getState().items.find(i => i.id === 'n1')!.readAt).not.toBeNull();
    expect(useNoticeInboxStore.getState().items.find(i => i.id === 'n2')!.readAt).toBeNull();
    expect(r.queryAllByText('2')).toHaveLength(0);
    expect(r.getAllByText('1').length).toBeGreaterThan(0);
  });
});

/**
 * **T-114/T-115 (PO 2026-09-13): la foto de perfil es un botón, y se nota.**
 * El anillo de marca alrededor del avatar es lo que sugiere que es tocable —
 * ahora que "Yo" ya no está en el tab bar, es el ÚNICO camino a esa pantalla.
 */
describe('el avatar del header sugiere que es un botón (T-115)', () => {
  it('el avatar lleva un borde (anillo) de color de marca', () => {
    const r = montar();
    const boton = r.getByTestId('header-profile');
    const conAnillo = boton.findAllByType(View).filter((v: ReturnType<typeof boton.findAllByType>[number]) => {
      const flat = StyleSheet.flatten(v.props.style);
      return flat?.borderWidth > 0 && !!flat?.borderColor;
    });
    expect(conAnillo.length).toBeGreaterThan(0);
  });

  it('mantiene el accessibilityLabel "Tu perfil" (i18n, clave sin cambios)', () => {
    const r = montar();
    // El mock de i18n en este proyecto devuelve la CLAVE, nunca el string
    // traducido — así que lo que se prueba es que sigue siendo esta clave.
    expect(r.getByTestId('header-profile').props.accessibilityLabel).toBe('dashboard.go_to_profile');
  });
});

/**
 * **T-114: el saludo de Inicio vive en el header, no en el contenido.**
 */
describe('subtítulo (saludo) — sólo cuando la pantalla lo pasa', () => {
  it('sin subtitle, no aparece ningún saludo', () => {
    const r = montar();
    expect(r.queryByTestId('header-subtitle')).toBeNull();
  });

  it('con subtitle, aparece arriba del título', () => {
    const r = render(<TabHeader title="Tus cuentas" subtitle="Hola, Ana" progress={crearProgress()} />);
    expect(r.getByTestId('header-subtitle')).toBeTruthy();
    expect(r.getByText('Hola, Ana')).toBeTruthy();
    // T-128: "Tus cuentas" vive en dos lugares — el título grande (siempre en
    // el DOM, recortado por el header al colapsar) y el título chico junto a
    // la foto de perfil (oculto por opacidad hasta que se colapsa).
    expect(r.getAllByText('Tus cuentas', { includeHiddenElements: true }).length).toBe(2);
    // El chico está oculto al lector de pantalla (T-128): se anuncia UNA sola vez.
    expect(r.getAllByText('Tus cuentas').length).toBe(1);
  });
});

/**
 * **Guard de clase.** El valor de unificar el header es que la próxima tab lo
 * herede sin acordarse. Una tab que monte `CollapsibleHeader` a mano se queda
 * sin campana —o sea, sin forma de enterarse de nada— y nadie lo nota hasta que
 * a alguien no le llegue un aviso. Falla por diferencia, como el inventario de
 * la bandeja.
 */
describe('ninguna tab arma su propio header', () => {
  it('las seis usan TabHeader', () => {
    const dir = join(__dirname, '..', '..', '..', 'app', '(tabs)');
    const tabs = readdirSync(dir).filter(f => f.endsWith('.tsx') && f !== '_layout.tsx');

    expect(tabs.length).toBe(6);
    for (const tab of tabs) {
      const src = readFileSync(join(dir, tab), 'utf8');
      expect(`${tab}: ${src.includes('<TabHeader')}`).toBe(`${tab}: true`);
      expect(`${tab}: ${src.includes('<CollapsibleHeader')}`).toBe(`${tab}: false`);
    }
  });
});

/**
 * T-136: el aviso de claves en disputa se resuelve eligiendo, no leyéndolo.
 * Tocarlo abre la tarjeta; «Decidir después» la cierra y el aviso sigue
 * pendiente.
 */
describe('T-136 · el aviso de claves en disputa abre la elección', () => {
  const conflicto: KeyConflictNotice = {
    kind: 'group_key_conflict', groupId: 'g1', groupName: 'Viaje',
    senderIds: ['u-beto', 'u-mallory'],
  };

  function dosOfertas(): void {
    registrarOferta({ groupId: 'g1', fromUserId: 'u-beto', key: 'cd'.repeat(32), epoch: 1, origen: 'contact', receivedAt: 0, adoptada: false });
    registrarOferta({ groupId: 'g1', fromUserId: 'u-mallory', key: 'ab'.repeat(32), epoch: 1, origen: 'contact', receivedAt: 0, adoptada: false });
  }

  beforeEach(() => {
    createSecureStorage('groupkeys').clearAll();
    useNoticeInboxStore.setState({ items: [{ id: 'n1', readAt: null, createdAt: 0, notice: conflicto }] });
  });

  const leido = () => useNoticeInboxStore.getState().items[0]!.readAt;

  it('tocar el aviso abre la tarjeta con los remitentes y NO lo marca leído', () => {
    dosOfertas();
    const r = montar();
    fireEvent.press(r.getByTestId('notice-bell'));
    fireEvent.press(r.getByTestId('notice-n1'));

    expect(r.getByTestId('key-conflict-card')).toBeTruthy();
    expect(r.getByTestId('key-conflict-sender-u-beto')).toBeTruthy();
    expect(r.getByTestId('key-conflict-sender-u-mallory')).toBeTruthy();
    expect(leido()).toBeNull();
  });

  it('«Decidir después» cierra la tarjeta y el aviso sigue pendiente', () => {
    dosOfertas();
    const r = montar();
    fireEvent.press(r.getByTestId('notice-bell'));
    fireEvent.press(r.getByTestId('notice-n1'));
    fireEvent.press(r.getByTestId('key-conflict-later'));

    expect(r.queryByTestId('key-conflict-card')).toBeNull();
    expect(leido()).toBeNull();
  });

  it('si ya no hay conflicto (menos de dos ofertas), tocarlo lo marca leído sin abrir nada', () => {
    const r = montar();
    fireEvent.press(r.getByTestId('notice-bell'));
    fireEvent.press(r.getByTestId('notice-n1'));

    expect(r.queryByTestId('key-conflict-card')).toBeNull();
    expect(leido()).not.toBeNull();
  });
});
