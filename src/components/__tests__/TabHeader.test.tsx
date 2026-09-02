import React from 'react';
import { Animated } from 'react-native';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { fireEvent, render } from '@testing-library/react-native';
import { TabHeader } from '../TabHeader';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';
import type { User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

/** Un data URI mínimo: alcanza para que `Avatar` dibuje una `<Image>`. */
const FOTO = 'data:image/png;base64,iVBORw0KGgo=';

const ANA = { id: 'ana', name: 'Ana' } as User;

function montar() {
  return render(<TabHeader title="Test" scrollY={new Animated.Value(0)} />);
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
