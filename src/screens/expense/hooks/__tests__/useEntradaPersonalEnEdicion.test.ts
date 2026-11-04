import { renderHook } from '@testing-library/react-native';

import { claveDeTitulo, useEntradaPersonalEnEdicion } from '../useEntradaPersonalEnEdicion';
import { usePersonalStore } from '@/src/store/personalStore';
import type { PersonalEntry } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

const entry = (over: Partial<PersonalEntry> = {}): PersonalEntry => ({
  id: 'p1', kind: 'expense', description: 'Café', amount: 1, currency: 'ARS',
  category: 'food', date: 0, createdAt: 0, updatedAt: 1, isDeleted: false, ...over,
} as PersonalEntry);

const usar = (id?: string) => renderHook(() => useEntradaPersonalEnEdicion(id)).result.current;

describe('useEntradaPersonalEnEdicion (T-257)', () => {
  it('devuelve la entrada manual', () => {
    usePersonalStore.setState({ entries: [entry()] });
    const e = entry({ kind: 'income', amount: 700, currency: 'USD', category: 'salary', date: 5 });
    usePersonalStore.setState({ entries: [e] });
    expect(usar('p1')).toEqual({
      editing: true,
      inicial: { description: 'Café', amount: 700, currency: 'USD', category: 'salary', date: new Date(5), isIncome: true },
    });
  });

  it.each([
    ['sin id', undefined, entry()],
    ['id inexistente', 'zzz', entry()],
    ['derivada', 'p1', entry({ kind: 'group_replicated' })],
    ['borrada', 'p1', entry({ isDeleted: true })],
  ])('no edita: %s', (_n, id, e) => {
    usePersonalStore.setState({ entries: [e] });
    expect(usar(id)).toEqual({ inicial: undefined, editing: false });
  });
});

describe('claveDeTitulo', () => {
  it('elige el título según edición y tipo', () => {
    expect(claveDeTitulo(true, false)).toBe('expense.edit_title');
    expect(claveDeTitulo(true, true)).toBe('expense.edit_income_title');
    expect(claveDeTitulo(false, false)).toBe('expense.new_title');
    expect(claveDeTitulo(false, true)).toBe('expense.new_income_title');
  });
});
