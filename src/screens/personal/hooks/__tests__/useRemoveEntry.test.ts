import { Alert } from 'react-native';
import { renderHook } from '@testing-library/react-native';

import { useRemoveEntry } from '../useRemoveEntry';
import { usePersonalStore } from '@/src/store/personalStore';
import type { PersonalEntry } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/utils/haptics', () => ({ hapticWarning: jest.fn() }));

const entry = (over: Partial<PersonalEntry>): PersonalEntry => ({
  id: 'e1', kind: 'expense', description: 'Café', amount: 500, currency: 'ARS',
  category: 'food', date: Date.now(), createdAt: 0, updatedAt: 1, isDeleted: false, ...over,
} as PersonalEntry);

const mesPasado = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15).getTime();

describe('borrar una entrada personal (T-259)', () => {
  let alerta: jest.SpyInstance;
  beforeEach(() => { alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {}); });
  afterEach(() => alerta.mockRestore());

  it('una del mes corriente pide confirmación y borra', () => {
    const removeEntry = jest.fn();
    usePersonalStore.setState({ removeEntry } as never);
    renderHook(() => useRemoveEntry()).result.current(entry({}));
    const botones = alerta.mock.calls[0][2] as { onPress?: () => void }[];
    botones[1].onPress?.();
    expect(removeEntry).toHaveBeenCalledWith('e1');
  });

  it('una de un mes cerrado no se borra y dice por qué', () => {
    const removeEntry = jest.fn();
    usePersonalStore.setState({ removeEntry } as never);
    renderHook(() => useRemoveEntry()).result.current(entry({ date: mesPasado }));
    expect(alerta).toHaveBeenCalledWith('personal.locked_title', 'personal.locked_closed_month');
    expect(removeEntry).not.toHaveBeenCalled();
  });
});
