import { usePersonalStore } from '../personalStore';
import type { PersonalEntry } from '@/src/types/models';

const entry = (over: Partial<PersonalEntry> = {}): PersonalEntry => ({
  id: 'e1', kind: 'expense', description: 'Café', amount: 500, currency: 'ARS',
  category: 'food', date: 0, createdAt: 0, updatedAt: 1_000, isDeleted: false,
  ...over,
} as PersonalEntry);

beforeEach(() => usePersonalStore.setState({ entries: [] }));

describe('personalStore.updateEntry (T-257)', () => {
  it('aplica los cambios y sube updatedAt', () => {
    usePersonalStore.setState({ entries: [entry()] });
    usePersonalStore.getState().updateEntry('e1', { description: 'Cena', amount: 900, currency: 'USD' });
    const e = usePersonalStore.getState().entries[0]!;
    expect(e).toMatchObject({ description: 'Cena', amount: 900, currency: 'USD', kind: 'expense', createdAt: 0 });
    expect(e.updatedAt).toBeGreaterThan(1_000);
  });

  it('un merge con la versión vieja no pisa la edición', () => {
    usePersonalStore.setState({ entries: [entry()] });
    usePersonalStore.getState().updateEntry('e1', { description: 'Editado' });
    usePersonalStore.getState().mergeEntries([entry({ description: 'Viejo', updatedAt: 1_000 })]);
    expect(usePersonalStore.getState().entries[0]!.description).toBe('Editado');
  });

  it('no toca entradas derivadas', () => {
    usePersonalStore.setState({ entries: [entry({ kind: 'group_replicated' })] });
    usePersonalStore.getState().updateEntry('e1', { description: 'Hack' });
    expect(usePersonalStore.getState().entries[0]!.description).toBe('Café');
  });

  it('un id inexistente no hace nada', () => {
    usePersonalStore.setState({ entries: [entry()] });
    usePersonalStore.getState().updateEntry('nope', { amount: 1 });
    expect(usePersonalStore.getState().entries).toHaveLength(1);
    expect(usePersonalStore.getState().entries[0]!.amount).toBe(500);
  });
});
