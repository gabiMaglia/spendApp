import { renderHook } from '@testing-library/react-native';

import { useGuardarGasto, type FormularioDeGasto } from '../useGuardarGasto';
import { useRecurringStore } from '@/src/store/recurringStore';
import { splitsDePlantilla } from '@/src/algorithms/recurringSplits';
import { calcularSplits } from '../../repartoDeGasto';
import type { User } from '@/src/types/models';

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/motor/relayEngine', () => ({ schedulePublish: jest.fn(), startRelay: jest.fn(), deviceId: () => 'dev' }));
jest.mock('@/src/utils/haptics', () => ({ hapticSuccess: jest.fn() }));

const yo = { id: 'a' } as User;

function form(over: Partial<FormularioDeGasto>): FormularioDeGasto {
  const splits = calcularSplits({
    amount: 10001, members: ['a', 'b', 'c'], splitMode: 'percentage',
    percentSub: 'custom', samePercent: '', customPercents: ['33.33', '33.33'],
  });
  return {
    currentUser: yo, isEditMode: false, hasGroup: true, groupId: 'g1',
    description: 'Alquiler', amount: 10001, currency: 'ARS', category: 'other',
    date: new Date(Date.UTC(2026, 0, 10)), note: '', isIncome: false, payerId: 'a',
    multiPayer: false, payers: [], splits, splitMode: 'percentage',
    recurrence: 'monthly', needsAd: false, canSave: true, ...over,
  } as FormularioDeGasto;
}

beforeEach(() => useRecurringStore.setState({ recurring: [] }));

describe('plantilla recurrente al guardar un gasto', () => {
  it('en porcentaje guarda los % y reproduce el reparto que vio el usuario', () => {
    const f = form({});
    renderHook(() => useGuardarGasto(f)).result.current();

    const t = useRecurringStore.getState().recurring[0]!;
    expect(t.splitValues).toBeDefined();
    const r = splitsDePlantilla(t);
    expect(r.degradado).toBe(false);
    expect(r.splits.map(s => s.amount)).toEqual(f.splits.map(s => s.amount));
  });

  it('en partes iguales no guarda valores', () => {
    const f = form({
      splitMode: 'equal',
      splits: calcularSplits({ amount: 10001, members: ['a', 'b'], splitMode: 'equal', percentSub: 'same', samePercent: '', customPercents: [] }),
    });
    renderHook(() => useGuardarGasto(f)).result.current();
    expect(useRecurringStore.getState().recurring[0]!.splitValues).toBeUndefined();
  });
});
