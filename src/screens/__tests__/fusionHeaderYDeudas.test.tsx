import React from 'react';
import { render } from '@testing-library/react-native';
import PersonalScreen from '@/app/(tabs)/index';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useUserStore } from '@/src/store/userStore';
import type { User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}),
}));

const GABRIEL = { id: 'gabriel', name: 'Gabriel Maglia' } as User;

beforeEach(() => {
  useAuthStore.setState({ currentUser: GABRIEL });
  useUserStore.setState({ users: [GABRIEL] });
  useGroupStore.setState({ groups: [] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  usePersonalStore.setState({ entries: [], budget: usePersonalStore.getState().budget });
});

/**
 * T-121 — el header fusionado usa el saludo de Inicio ("Tus cuentas" / "Hola,
 * {nombre}"), y el bloque "Te deben/Debes" (antes exclusivo de Inicio) es lo
 * primero que aparece en el contenido de la pantalla.
 */
describe('fusión Inicio→Personal: header y bloque de deuda arriba de todo', () => {
  // El mock de i18n en src/test-utils/setup.ts hace que `t(key, opts)`
  // devuelva la CLAVE (y `key({"opt":val})` cuando hay opts) en vez del
  // texto traducido — así es como todos los tests de este repo verifican
  // textos i18n, nunca contra el string en español.
  it('el header muestra la clave dashboard.title y el saludo con el primer nombre', () => {
    const r = render(<PersonalScreen />);

    expect(r.getByText('dashboard.title')).toBeTruthy();
    expect(r.getByText('dashboard.greeting({"name":"Gabriel"})')).toBeTruthy();
  });

  it('sin nombre de usuario, el saludo cae a "vos"', () => {
    useAuthStore.setState({ currentUser: { id: 'gabriel', name: undefined } as unknown as User });

    const r = render(<PersonalScreen />);

    expect(r.getByText('dashboard.greeting({"name":"vos"})')).toBeTruthy();
  });

  it('el bloque "Te deben" (friends.owed_to_you) aparece antes que la fila de ajustes', () => {
    const r = render(<PersonalScreen />);

    // getByTestId/getByText no dan posición, pero el árbol serializado sí
    // conserva el orden real de renderizado: comparar índices de strings
    // únicas en ese JSON es una forma simple y determinística de verificar
    // orden sin depender de una API de traversal más frágil.
    const arbol = JSON.stringify(r.toJSON());
    const indiceDeuda    = arbol.indexOf('friends.owed_to_you');
    const indiceAjustes  = arbol.indexOf('personal-settings-btn');

    expect(indiceDeuda).toBeGreaterThanOrEqual(0);
    expect(indiceAjustes).toBeGreaterThan(indiceDeuda);
  });
});
