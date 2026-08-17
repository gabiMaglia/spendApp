import { usePersonalStore } from '../personalStore';
import { useAuthStore } from '../authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { PersonalEntry, User } from '@/src/types/models';

const USER_A = { id: 'ua' } as User;
const USER_B = { id: 'ub' } as User;

function entry(over: Partial<PersonalEntry> = {}): PersonalEntry {
  return {
    id: 'p1', kind: 'expense', description: 'Café', amount: 500, currency: 'ARS',
    category: 'food', date: 0, createdAt: 0, updatedAt: 1_000, isDeleted: false,
    ...over,
  } as PersonalEntry;
}

const setActive = (u: User | null) => useAuthStore.setState({ currentUser: u });

describe('personalStore', () => {
  beforeEach(() => {
    const storage = createSecureStorage('personal');
    storage.clearAll();
    // Simula una instalación ya migrada (el estado normal). Sin este flag,
    // `hydrate` corre la conversión float→entero de T-006 sobre datos que ya
    // están en menor unidad y los multiplica por 100 — correcto para su
    // propósito, pero acá estaríamos probando dos cosas a la vez.
    storage.set('money_int_v1_done', true);
    setActive(USER_A);
    usePersonalStore.setState({ entries: [] });
  });

  it('agrega un movimiento', () => {
    usePersonalStore.getState().addEntry(entry());
    expect(usePersonalStore.getState().entries).toHaveLength(1);
  });

  it('distingue gasto de ingreso', () => {
    usePersonalStore.getState().addEntry(entry({ id: 'p1', kind: 'expense' }));
    usePersonalStore.getState().addEntry(entry({ id: 'p2', kind: 'income' }));

    const kinds = usePersonalStore.getState().entries.map(e => e.kind).sort();
    expect(kinds).toEqual(['expense', 'income']);
  });

  it('borrar es tombstone, no borrado físico', () => {
    usePersonalStore.getState().addEntry(entry());
    usePersonalStore.getState().removeEntry('p1');

    const all = usePersonalStore.getState().entries;
    expect(all).toHaveLength(1);
    expect(all[0]!.isDeleted).toBe(true);
  });

  it('persiste y sobrevive a un store fresco', () => {
    usePersonalStore.getState().addEntry(entry());

    usePersonalStore.setState({ entries: [] });
    usePersonalStore.getState().hydrate();

    expect(usePersonalStore.getState().entries).toHaveLength(1);
  });

  it('los movimientos son POR CUENTA: otra cuenta no los ve', () => {
    usePersonalStore.getState().addEntry(entry());

    setActive(USER_B);
    usePersonalStore.getState().hydrate();

    expect(usePersonalStore.getState().entries).toHaveLength(0);
  });

  it('el presupuesto persiste', () => {
    usePersonalStore.getState().setBudget({
      currency: 'ARS', monthlyAmount: 100000, includeOwedToMe: false,
    });

    usePersonalStore.getState().hydrate();

    expect(usePersonalStore.getState().budget.monthlyAmount).toBe(100000);
  });

  describe('mergeEntries (sync P2P — antes NO viajaban en el delta)', () => {
    it('trae movimientos del otro device', () => {
      usePersonalStore.getState().mergeEntries([entry({ id: 'p2' })]);
      expect(usePersonalStore.getState().entries).toHaveLength(1);
    });

    it('gana la versión más nueva', () => {
      usePersonalStore.getState().addEntry(entry({ description: 'viejo', updatedAt: 1_000 }));
      usePersonalStore.getState().mergeEntries([entry({ description: 'nuevo', updatedAt: 2_000 })]);

      expect(usePersonalStore.getState().entries[0]!.description).toBe('nuevo');
    });

    it('no pisa con una más vieja', () => {
      usePersonalStore.getState().addEntry(entry({ description: 'nuevo', updatedAt: 2_000 }));
      usePersonalStore.getState().mergeEntries([entry({ description: 'viejo', updatedAt: 1_000 })]);

      expect(usePersonalStore.getState().entries[0]!.description).toBe('nuevo');
    });

    it('un tombstone entrante se propaga', () => {
      usePersonalStore.getState().addEntry(entry({ updatedAt: 1_000 }));
      usePersonalStore.getState().mergeEntries([entry({ isDeleted: true, updatedAt: 2_000 })]);

      expect(usePersonalStore.getState().entries[0]!.isDeleted).toBe(true);
    });

    it('mergear lo mismo dos veces no duplica', () => {
      const e = entry();
      usePersonalStore.getState().mergeEntries([e]);
      usePersonalStore.getState().mergeEntries([e]);

      expect(usePersonalStore.getState().entries).toHaveLength(1);
    });
  });
});
