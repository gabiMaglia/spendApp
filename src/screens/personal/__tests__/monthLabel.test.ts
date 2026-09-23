import { monthLabel, prevMonth, nextMonth } from '@/src/screens/personal/utils/monthLabel';

describe('personalMonthLabel', () => {
  it('monthLabel capitaliza el mes', () => {
    expect(monthLabel('2026-09')).toBe('Septiembre de 2026');
  });

  it('prevMonth retrocede un mes', () => {
    expect(prevMonth('2026-09')).toBe('2026-08');
  });

  it('prevMonth cruza el año hacia atrás', () => {
    expect(prevMonth('2026-01')).toBe('2025-12');
  });

  it('nextMonth avanza un mes', () => {
    expect(nextMonth('2026-09')).toBe('2026-10');
  });

  it('nextMonth cruza el año hacia adelante', () => {
    expect(nextMonth('2026-12')).toBe('2027-01');
  });
});
