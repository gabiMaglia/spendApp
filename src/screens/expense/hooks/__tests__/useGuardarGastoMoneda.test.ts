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

describe('editar una entrada personal (T-257)', () => {
  const base = { id: 'p1', kind: 'expense', description: 'Viejo', amount: 100, currency: 'ARS',
    category: 'food', date: 0, createdAt: 5, updatedAt: 1, isDeleted: false } as const;

  it('guarda con updateEntry: misma entrada, sin duplicar, respetando la moneda', () => {
    usePersonalStore.setState({ entries: [{ ...base }] });
    renderHook(() => useGuardarGasto(form({
      isEditMode: true, personalEntryId: 'p1', currency: 'USD', amount: 2500, description: ' Nuevo ',
    }))).result.current();
    const es = usePersonalStore.getState().entries;
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ id: 'p1', description: 'Nuevo', amount: 2500, currency: 'USD', createdAt: 5 });
    expect(es[0]!.updatedAt).toBeGreaterThan(1);
  });

  it('un ingreso editado sigue siendo ingreso con categoría other', () => {
    usePersonalStore.setState({ entries: [{ ...base, kind: 'income' }] });
    renderHook(() => useGuardarGasto(form({
      isEditMode: true, personalEntryId: 'p1', isIncome: true, category: 'food',
    }))).result.current();
    expect(usePersonalStore.getState().entries[0]).toMatchObject({ kind: 'income', category: 'other' });
  });
});
