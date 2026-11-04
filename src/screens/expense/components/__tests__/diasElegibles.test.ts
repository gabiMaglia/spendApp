import { diasElegibles } from '../HojasDeGasto';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

describe('diasElegibles (T-259)', () => {
  it('ofrece los últimos 7 días, de hoy hacia atrás', () => {
    const dias = diasElegibles(false, new Date(2026, 10, 15, 9));
    expect(dias.map(d => d.getDate())).toEqual([15, 14, 13, 12, 11, 10, 9]);
  });

  it('un gasto de grupo puede caer en el mes anterior', () => {
    const dias = diasElegibles(false, new Date(2026, 10, 3, 9));
    expect(dias.map(d => d.getDate())).toEqual([3, 2, 1, 31, 30, 29, 28]);
  });

  it('un gasto personal no sale del mes en curso', () => {
    const dias = diasElegibles(true, new Date(2026, 10, 3, 9));
    expect(dias.map(d => d.getDate())).toEqual([3, 2, 1]);
  });

  it('el día 1 sólo queda hoy', () => {
    expect(diasElegibles(true, new Date(2026, 0, 1, 9))).toHaveLength(1);
  });
});
