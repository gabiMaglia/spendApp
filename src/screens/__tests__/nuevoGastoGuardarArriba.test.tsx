import React from 'react';
import { render } from '@testing-library/react-native';
import NewExpenseScreen from '@/app/expense/new';
import { useSettingsStore } from '@/src/store/settingsStore';
import { useAuthStore } from '@/src/store/authStore';
import type { User } from '@/src/types/models';

/** T-281: Guardar va ARRIBA de la barra de herramientas, que queda en la base. */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/motor/relayEngine', () => ({ schedulePublish: jest.fn(), startRelay: jest.fn(), deviceId: () => 'dev' }));
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

/** testIDs en orden de aparición (profundidad primero = orden visual vertical). */
function idsEnOrden(nodo: unknown, acc: string[] = []): string[] {
  if (!nodo || typeof nodo !== 'object') return acc;
  const n = nodo as { props?: { testID?: string }; children?: unknown[] | null };
  if (n.props?.testID) acc.push(n.props.testID);
  (n.children ?? []).forEach(h => idsEnOrden(h, acc));
  return acc;
}

describe.each(['default', 'aero'] as const)('Nuevo gasto / ingreso (skin %s)', skin => {
  beforeEach(() => {
    useAuthStore.setState({ currentUser: { id: 'u' } as User });
    useSettingsStore.setState({ skin, displayCurrency: 'ARS' });
  });

  it.each([{ allowIncome: '1', kind: 'expense' }, { allowIncome: '1', kind: 'income' }])('Guardar queda sobre la barra (%j)', params => {
    mockParams = params;
    const ids = idsEnOrden(render(<NewExpenseScreen />).toJSON());
    const guardar = ids.indexOf('expense-save-btn');
    const barra = ids.indexOf('barra-herramientas');
    expect(guardar).toBeGreaterThanOrEqual(0);
    expect(barra).toBeGreaterThan(guardar);
  });
});
