import { searchActivity } from '../searchActivity';
import type { ActivityKind } from '@/src/store/selectors';

const nombreDe = (id: string) => ({ ana: 'Ana', beto: 'Beto', caro: 'Caro' }[id] ?? id);

const gasto = (desc: string, grupo = 'Asado', pagador = 'ana'): ActivityKind => ({
  kind: 'expense_added',
  groupName: grupo,
  expense: { id: desc, description: desc, paidById: pagador } as any,
});

const pago = (grupo = 'Viaje'): ActivityKind => ({
  kind: 'payment_made',
  groupName: grupo,
  payment: { id: 'p1', fromUserId: 'beto', toUserId: 'caro' } as any,
});

const feed: ActivityKind[] = [gasto('Nafta'), gasto('Almuerzo Ñandú', 'Vacaciones'), pago()];

describe('searchActivity', () => {
  it('sin busqueda devuelve el feed TAL CUAL, sin copiarlo', () => {
    expect(searchActivity(feed, '', nombreDe)).toBe(feed);
    expect(searchActivity(feed, '   ', nombreDe)).toBe(feed);
  });

  it('encuentra por descripcion', () => {
    expect(searchActivity(feed, 'nafta', nombreDe)).toHaveLength(1);
  });

  it('encuentra por nombre de grupo', () => {
    expect(searchActivity(feed, 'vacaciones', nombreDe)).toHaveLength(1);
  });

  it('encuentra por quien pago', () => {
    const r = searchActivity([gasto('Nafta', 'Asado', 'beto')], 'beto', nombreDe);
    expect(r).toHaveLength(1);
  });

  it('encuentra un pago por quien lo hizo o lo recibio', () => {
    expect(searchActivity(feed, 'caro', nombreDe)).toHaveLength(1);
  });

  it('ignora mayusculas', () => {
    expect(searchActivity(feed, 'NAFTA', nombreDe)).toHaveLength(1);
  });

  it('ignora acentos: quien escribe rapido no pone la tilde', () => {
    expect(searchActivity(feed, 'nandu', nombreDe)).toHaveLength(1);
    expect(searchActivity(feed, 'ñandú', nombreDe)).toHaveLength(1);
  });

  it('busca por fragmento, no solo por palabra completa', () => {
    expect(searchActivity(feed, 'almu', nombreDe)).toHaveLength(1);
  });

  it('sin coincidencias devuelve vacio', () => {
    expect(searchActivity(feed, 'zzzz', nombreDe)).toEqual([]);
  });

  it('no explota si falta el nombre de quien pago', () => {
    const raro = [{ kind: 'expense_added', groupName: 'X', expense: { description: 'Y' } } as any];
    expect(() => searchActivity(raro, 'y')).not.toThrow();
  });
});
