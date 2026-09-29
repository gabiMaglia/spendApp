import { contarSinVer } from '@/src/screens/activity/utils/sinVer';
import type { ActivityKind } from '@/src/store/selectors';
import type { Expense, Payment, PersonalEntry } from '@/src/types/models';

/**
 * «N sin ver» en la franja Hoy de Actividad (PO 2026-09-29). Antes contaba
 * TODO lo de hoy —incluido lo propio— y nunca bajaba, porque no existía
 * ningún registro de «visto». Ahora: movimientos de OTRAS personas que
 * llegaron después de la última vez que salí de Actividad.
 */
const YO = 'yo';
const esMio = (id?: string) => id === YO;

const gasto = (createdById: string, createdAt: number, extra: Partial<Expense> = {}): ActivityKind => ({
  kind: 'expense_added', groupName: 'g',
  expense: { id: `e${createdAt}`, createdById, createdAt, date: 1, updatedAt: createdAt, isDeleted: false, ...extra } as Expense,
});
const pago = (createdById: string, createdAt: number): ActivityKind => ({
  kind: 'payment_made', groupName: 'g',
  payment: { id: `p${createdAt}`, createdById, createdAt, date: 1, updatedAt: createdAt } as Payment,
});

describe('contarSinVer', () => {
  it('cuenta los movimientos de otros que llegaron después de la última visita', () => {
    const feed = [gasto('ana', 200), gasto('ana', 50), pago('beto', 300)];
    expect(contarSinVer(feed, 100, esMio)).toBe(2);
  });

  it('lo mío nunca cuenta', () => {
    expect(contarSinVer([gasto(YO, 500), pago(YO, 500)], 0, esMio)).toBe(0);
  });

  it('un gasto cargado recién con fecha vieja también es nuevo (cuenta la llegada, no la fecha elegida)', () => {
    expect(contarSinVer([gasto('ana', 500, { date: 10 })], 100, esMio)).toBe(1);
  });

  it('borrados y restaurados cuentan según quién los hizo y cuándo', () => {
    const borradoPorAna: ActivityKind = {
      kind: 'expense_deleted', groupName: 'g',
      expense: { id: 'x', createdById: YO, createdAt: 1, date: 1, updatedAt: 400, deletedById: 'ana', isDeleted: true } as Expense,
    };
    const restauradoPorMi: ActivityKind = {
      kind: 'expense_restored', groupName: 'g', restoredByName: 'yo',
      expense: { id: 'y', createdById: 'ana', createdAt: 1, date: 1, updatedAt: 400, restoredById: YO, isDeleted: false } as Expense,
    };
    expect(contarSinVer([borradoPorAna, restauradoPorMi], 100, esMio)).toBe(1);
  });

  it('los movimientos personales son siempre míos', () => {
    const personal: ActivityKind = {
      kind: 'personal_entry', groupName: '',
      entry: { id: 'z', createdAt: 999, date: 999, updatedAt: 999 } as PersonalEntry,
    };
    expect(contarSinVer([personal], 0, esMio)).toBe(0);
  });

  it('sin movimientos, cero', () => {
    expect(contarSinVer([], 0, esMio)).toBe(0);
  });
});
