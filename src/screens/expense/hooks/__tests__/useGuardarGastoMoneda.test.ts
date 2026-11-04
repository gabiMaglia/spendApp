import { renderHook } from '@testing-library/react-native';

import { useGuardarGasto, type FormularioDeGasto } from '../useGuardarGasto';
import { usePersonalStore } from '@/src/store/personalStore';
import { useSettingsStore } from '@/src/store/settingsStore';
import type { User } from '@/src/types/models';

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/motor/relayEngine', () => ({ schedulePublish: jest.fn(), startRelay: jest.fn(), deviceId: () => 'dev' }));
jest.mock('@/src/utils/haptics', () => ({ hapticSuccess: jest.fn() }));

function form(over: Partial<FormularioDeGasto>): FormularioDeGasto {
  return {
    currentUser: { id: 'a' } as User, isEditMode: false, hasGroup: false, groupId: '',
    description: 'Café', amount: 1500, currency: 'CLP', category: 'other',
    date: new Date(Date.UTC(2026, 0, 10)), note: '', isIncome: false, payerId: 'a',
    multiPayer: false, payers: [], splits: [], splitMode: 'equal',
    recurrence: null, needsAd: false, canSave: true, ...over,
  } as FormularioDeGasto;
}

beforeEach(() => {
  usePersonalStore.setState({ entries: [] });
  useSettingsStore.setState({ lastPersonalCurrency: null });
});

describe('moneda al guardar un gasto personal (T-255)', () => {
  it('guarda en la moneda elegida, sin convertir el monto', () => {
    renderHook(() => useGuardarGasto(form({}))).result.current();
    const e = usePersonalStore.getState().entries[0]!;
    expect(e.currency).toBe('CLP');
    expect(e.amount).toBe(1500);
  });

  it('recuerda esa moneda como la última usada', () => {
    renderHook(() => useGuardarGasto(form({ currency: 'USD' }))).result.current();
    expect(useSettingsStore.getState().lastPersonalCurrency).toBe('USD');
  });
});
