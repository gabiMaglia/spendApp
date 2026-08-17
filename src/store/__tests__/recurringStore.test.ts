import { useRecurringStore } from '../recurringStore';
import { useAuthStore } from '../authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { RecurringExpense, User } from '@/src/types/models';

const USER_A = { id: 'ua' } as User;
const USER_B = { id: 'ub' } as User;

function template(over: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id: 'r1', groupId: 'g1', description: 'Alquiler', amount: 50000, currency: 'ARS',
    paidById: 'ua', splitMode: 'equal', memberIds: ['ua', 'ub'], category: 'home',
    rule: { frequency: 'monthly', startDate: 0 },
    lastMaterializedAt: null, isActive: true,
    createdAt: 0, createdById: 'ua', updatedAt: 1_000, isDeleted: false,
    ...over,
  } as RecurringExpense;
}

const setActive = (u: User | null) => useAuthStore.setState({ currentUser: u });

describe('recurringStore', () => {
  beforeEach(() => {
    createSecureStorage('recurring').clearAll();
    setActive(USER_A);
    useRecurringStore.setState({ recurring: [], isLoading: false });
  });

  it('agrega una plantilla y la encuentra por id', () => {
    useRecurringStore.getState().addRecurring(template());
    expect(useRecurringStore.getState().getById('r1')?.description).toBe('Alquiler');
  });

  describe('active()', () => {
    it('devuelve las vivas', () => {
      useRecurringStore.getState().addRecurring(template());
      expect(useRecurringStore.getState().active()).toHaveLength(1);
    });

    it('excluye las pausadas', () => {
      useRecurringStore.getState().addRecurring(template({ isActive: false }));
      expect(useRecurringStore.getState().active()).toHaveLength(0);
    });

    it('excluye las borradas', () => {
      useRecurringStore.getState().addRecurring(template({ isDeleted: true }));
      expect(useRecurringStore.getState().active()).toHaveLength(0);
    });
  });

  it('pausar deja la plantilla pero la saca de active()', () => {
    useRecurringStore.getState().addRecurring(template());
    useRecurringStore.getState().updateRecurring('r1', { isActive: false });

    expect(useRecurringStore.getState().getById('r1')).toBeDefined();
    expect(useRecurringStore.getState().active()).toHaveLength(0);
  });

  it('actualizar refresca updatedAt (para que gane en el LWW)', () => {
    useRecurringStore.getState().addRecurring(template({ updatedAt: 1_000 }));
    useRecurringStore.getState().updateRecurring('r1', { lastMaterializedAt: 5_000 });

    expect(useRecurringStore.getState().getById('r1')!.updatedAt).toBeGreaterThan(1_000);
  });

  it('borrar es tombstone, no borrado físico', () => {
    useRecurringStore.getState().addRecurring(template());
    useRecurringStore.getState().removeRecurring('r1');

    expect(useRecurringStore.getState().recurring).toHaveLength(1);
    expect(useRecurringStore.getState().getById('r1')!.isDeleted).toBe(true);
  });

  it('persiste y sobrevive a un store fresco', () => {
    useRecurringStore.getState().addRecurring(template());

    useRecurringStore.setState({ recurring: [] });
    useRecurringStore.getState().hydrate();

    expect(useRecurringStore.getState().recurring).toHaveLength(1);
  });

  it('las plantillas son POR CUENTA: otra cuenta no las ve', () => {
    useRecurringStore.getState().addRecurring(template());

    setActive(USER_B);
    useRecurringStore.getState().hydrate();

    expect(useRecurringStore.getState().recurring).toHaveLength(0);
  });

  describe('mergeRecurring (sync P2P)', () => {
    it('trae plantillas nuevas del otro device', () => {
      useRecurringStore.getState().mergeRecurring([template({ id: 'r2' })]);
      expect(useRecurringStore.getState().recurring).toHaveLength(1);
    });

    it('gana la versión más nueva', () => {
      useRecurringStore.getState().addRecurring(template({ description: 'viejo', updatedAt: 1_000 }));
      useRecurringStore.getState().mergeRecurring([template({ description: 'nuevo', updatedAt: 2_000 })]);

      expect(useRecurringStore.getState().getById('r1')!.description).toBe('nuevo');
    });

    it('no pisa con una más vieja', () => {
      useRecurringStore.getState().addRecurring(template({ description: 'nuevo', updatedAt: 2_000 }));
      useRecurringStore.getState().mergeRecurring([template({ description: 'viejo', updatedAt: 1_000 })]);

      expect(useRecurringStore.getState().getById('r1')!.description).toBe('nuevo');
    });

    it('un tombstone entrante pausa la plantilla en este device', () => {
      useRecurringStore.getState().addRecurring(template({ updatedAt: 1_000 }));
      useRecurringStore.getState().mergeRecurring([template({ isDeleted: true, updatedAt: 2_000 })]);

      expect(useRecurringStore.getState().active()).toHaveLength(0);
    });

    it('mergear lo mismo dos veces no duplica', () => {
      const t = template();
      useRecurringStore.getState().mergeRecurring([t]);
      useRecurringStore.getState().mergeRecurring([t]);

      expect(useRecurringStore.getState().recurring).toHaveLength(1);
    });
  });
});
