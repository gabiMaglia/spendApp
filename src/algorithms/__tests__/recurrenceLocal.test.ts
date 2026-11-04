import { occurrenceAt, type RecurrenceRule } from '../recurrence';

// T-263: el día de la cuota es el del aparato, no el de UTC. Las fechas se
// arman con el constructor LOCAL y se leen con getters locales, así el test
// vale en cualquier huso (se corrió también con TZ=America/Santiago,
// Pacific/Auckland y UTC).
const local = (y: number, m: number, day: number, h = 0, mi = 0) => new Date(y, m - 1, day, h, mi).getTime();
const ymdhm = (ts: number) => {
  const x = new Date(ts);
  return [x.getFullYear(), x.getMonth() + 1, x.getDate(), x.getHours(), x.getMinutes()];
};
const monthly = (start: number): RecurrenceRule => ({ frequency: 'monthly', startDate: start });

describe('día local del aparato (T-263)', () => {
  it('mensual del 30 a las 22:00 locales cae el 28 de febrero y el 30 de abril, a la misma hora', () => {
    const r = monthly(local(2026, 1, 30, 22, 0));
    expect(ymdhm(occurrenceAt(r, 1))).toEqual([2026, 2, 28, 22, 0]);
    expect(ymdhm(occurrenceAt(r, 2))).toEqual([2026, 3, 30, 22, 0]);
    expect(ymdhm(occurrenceAt(r, 3))).toEqual([2026, 4, 30, 22, 0]);
  });

  it('mensual del 31 a las 00:30 locales conserva el 31 y degrada sólo en los meses cortos', () => {
    const r = monthly(local(2026, 1, 31, 0, 30));
    expect(ymdhm(occurrenceAt(r, 1))).toEqual([2026, 2, 28, 0, 30]);
    expect(ymdhm(occurrenceAt(r, 2))).toEqual([2026, 3, 31, 0, 30]);
  });

  it('anual del 29 de febrero cae el 28 en año no bisiesto y vuelve al 29', () => {
    const r: RecurrenceRule = { frequency: 'yearly', startDate: local(2028, 2, 29, 23, 0) };
    expect(ymdhm(occurrenceAt(r, 1))).toEqual([2029, 2, 28, 23, 0]);
    expect(ymdhm(occurrenceAt(r, 4))).toEqual([2032, 2, 29, 23, 0]);
  });

  it('semanal cargado cerca de medianoche mantiene hora y día de la semana a través de los cambios de horario', () => {
    const start = local(2026, 3, 1, 23, 30);
    const r: RecurrenceRule = { frequency: 'weekly', startDate: start };
    for (let n = 0; n < 40; n++) {
      const x = new Date(occurrenceAt(r, n));
      expect([x.getHours(), x.getMinutes(), x.getDay()]).toEqual([23, 30, new Date(start).getDay()]);
    }
  });

  it('quincenal mantiene la hora local a través de los cambios de horario', () => {
    const r: RecurrenceRule = { frequency: 'fortnightly', startDate: local(2026, 1, 1, 23, 45) };
    for (let n = 0; n < 30; n++) {
      const x = new Date(occurrenceAt(r, n));
      expect([x.getHours(), x.getMinutes()]).toEqual([23, 45]);
    }
  });
});
