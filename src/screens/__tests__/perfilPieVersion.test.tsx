import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render } from '@testing-library/react-native';
import UserScreen from '@/app/(tabs)/user';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';
import type { User } from '@/src/types/models';

/**
 * T-103.C — el PO: «quitá de Yo la leyenda "p2p sin servidor" después de la
 * versión y achicá drásticamente el padding/margin de abajo, lo que esté
 * desfasado». La versión en sí se sigue mostrando.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  useFocusEffect: jest.fn(),
}));

const ANA = { id: 'ana', name: 'Ana' } as User;

beforeEach(() => {
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [ANA] });
  useGroupStore.setState({ groups: [] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  useNoticeInboxStore.setState({ items: [] });
});

const RAIZ = join(__dirname, '..', '..', '..');
const leer = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

describe('T-103.C — pie de la pestaña Yo', () => {
  it('la pantalla sigue mostrando la línea de versión', () => {
    const { getByText } = render(<UserScreen />);
    expect(getByText(/profile\.version/)).toBeTruthy();
  });

  it('profile.version ya no lleva la leyenda "P2P sin servidor" en ningún idioma', () => {
    const es = JSON.parse(leer('src/i18n/locales/es.json'));
    const en = JSON.parse(leer('src/i18n/locales/en.json'));
    const pt = JSON.parse(leer('src/i18n/locales/pt.json'));

    for (const dict of [es, en, pt]) {
      expect(dict.profile.version).not.toMatch(/p2p/i);
      expect(dict.profile.version).not.toMatch(/servidor|server/i);
      // La versión en sí sigue interpolándose.
      expect(dict.profile.version).toContain('{{version}}');
    }
  });

  it('el padding/margin debajo de la versión se redujo del valor viejo (120)', () => {
    const src = leer('app/(tabs)/user.tsx');
    // El ScrollView de la pantalla ya no reserva 120 de aire al fondo — ese
    // colchón era para pantallas con FAB; Yo no tiene uno.
    expect(src).not.toMatch(/paddingBottom:\s*120/);
  });
});
