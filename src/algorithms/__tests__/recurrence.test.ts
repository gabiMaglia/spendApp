import {
  occurrenceAt, nextOccurrence, dueOccurrences, isExhausted,
  type RecurrenceRule,
} from '../recurrence';

const d = (y: number, m: number, day: number) => Date.UTC(y, m - 1, day);
const iso = (ts: number) => new Date(ts).toISOString().slice(0, 10);

const monthly = (start: number, endDate?: number): RecurrenceRule =>
  ({ frequency: 'monthly', startDate: start, endDate });

describe('occurrenceAt', () => {
  it('semanal avanza de a 7 días', () => {
    const r: RecurrenceRule = { frequency: 'weekly', startDate: d(2026, 1, 1) };
    expect(iso(occurrenceAt(r, 1))).toBe('2026-01-08');
    expect(iso(occurrenceAt(r, 3))).toBe('2026-01-22');
  });

  it('quincenal avanza de a 14 días', () => {
    const r: RecurrenceRule = { frequency: 'fortnightly', startDate: d(2026, 1, 1) };
    expect(iso(occurrenceAt(r, 1))).toBe('2026-01-15');
  });

  it('mensual conserva el día del mes', () => {
    const r = monthly(d(2026, 1, 10));
    expect(iso(occurrenceAt(r, 1))).toBe('2026-02-10');
    expect(iso(occurrenceAt(r, 2))).toBe('2026-03-10');
  });

  it('anual salta 12 meses', () => {
    const r: RecurrenceRule = { frequency: 'yearly', startDate: d(2026, 3, 5) };
    expect(iso(occurrenceAt(r, 1))).toBe('2027-03-05');
  });

  it('cruza el año correctamente', () => {
    const r = monthly(d(2026, 11, 15));
    expect(iso(occurrenceAt(r, 2))).toBe('2027-01-15');
  });

  describe('fin de mes (el caso que rompe implementaciones ingenuas)', () => {
    it('un alquiler del 31 cae al 28 en febrero', () => {
      const r = monthly(d(2026, 1, 31));
      expect(iso(occurrenceAt(r, 1))).toBe('2026-02-28');
    });

    it('y VUELVE al 31 en marzo — no queda degradado al 28', () => {
      const r = monthly(d(2026, 1, 31));
      expect(iso(occurrenceAt(r, 2))).toBe('2026-03-31');
      expect(iso(occurrenceAt(r, 3))).toBe('2026-04-30');
      expect(iso(occurrenceAt(r, 4))).toBe('2026-05-31');
    });

    it('respeta el 29 de febrero en año bisiesto', () => {
      const r = monthly(d(2028, 1, 29)); // 2028 es bisiesto
      expect(iso(occurrenceAt(r, 1))).toBe('2028-02-29');
    });

    it('el 30 cae al 28 en un febrero no bisiesto', () => {
      const r = monthly(d(2026, 1, 30));
      expect(iso(occurrenceAt(r, 1))).toBe('2026-02-28');
    });
  });
});

describe('nextOccurrence', () => {
  it('devuelve el próximo vencimiento estricto', () => {
    const r = monthly(d(2026, 1, 10));
    expect(iso(nextOccurrence(r, d(2026, 1, 10))!)).toBe('2026-02-10');
  });

  it('si preguntás antes del inicio, devuelve el inicio', () => {
    const r = monthly(d(2026, 5, 1));
    expect(iso(nextOccurrence(r, d(2026, 1, 1))!)).toBe('2026-05-01');
  });

  it('devuelve null cuando la regla ya venció', () => {
    const r = monthly(d(2026, 1, 1), d(2026, 3, 1));
    expect(nextOccurrence(r, d(2026, 3, 1))).toBeNull();
  });
});

describe('dueOccurrences (materialización al abrir la app)', () => {
  it('primera vez: trae desde el inicio', () => {
    const r = monthly(d(2026, 1, 10));
    const out = dueOccurrences(r, null, d(2026, 3, 15));
    expect(out.map(iso)).toEqual(['2026-01-10', '2026-02-10', '2026-03-10']);
  });

  // RECUPERACIÓN: la app estuvo cerrada meses
  it('trae TODOS los vencidos, no sólo el último', () => {
    const r = monthly(d(2026, 1, 10));
    const out = dueOccurrences(r, d(2026, 1, 10), d(2026, 5, 15));
    expect(out.map(iso)).toEqual(['2026-02-10', '2026-03-10', '2026-04-10', '2026-05-10']);
  });

  // IDEMPOTENCIA: abrir la app dos veces no duplica
  it('no devuelve nada si ya se materializó todo lo vencido', () => {
    const r = monthly(d(2026, 1, 10));
    expect(dueOccurrences(r, d(2026, 3, 10), d(2026, 3, 20))).toEqual([]);
  });

  it('correr dos veces seguidas da lo mismo la primera y vacío la segunda', () => {
    const r = monthly(d(2026, 1, 10));
    const now = d(2026, 3, 15);
    const first = dueOccurrences(r, null, now);
    const second = dueOccurrences(r, first[first.length - 1]!, now);
    expect(first).toHaveLength(3);
    expect(second).toEqual([]);
  });

  it('incluye el vencimiento que cae exactamente hoy', () => {
    const r = monthly(d(2026, 1, 10));
    const out = dueOccurrences(r, d(2026, 1, 10), d(2026, 2, 10));
    expect(out.map(iso)).toEqual(['2026-02-10']);
  });

  it('no pasa de endDate', () => {
    const r = monthly(d(2026, 1, 10), d(2026, 3, 10));
    const out = dueOccurrences(r, null, d(2026, 12, 31));
    expect(out.map(iso)).toEqual(['2026-01-10', '2026-02-10', '2026-03-10']);
  });

  it('una regla que todavía no empezó no devuelve nada', () => {
    const r = monthly(d(2027, 1, 1));
    expect(dueOccurrences(r, null, d(2026, 6, 1))).toEqual([]);
  });

  it('semanal acumula varias semanas de ausencia', () => {
    const r: RecurrenceRule = { frequency: 'weekly', startDate: d(2026, 1, 1) };
    expect(dueOccurrences(r, null, d(2026, 1, 29))).toHaveLength(5);
  });
});

describe('isExhausted', () => {
  it('es true pasado el endDate', () => {
    expect(isExhausted(monthly(d(2026, 1, 1), d(2026, 2, 1)), d(2026, 3, 1))).toBe(true);
  });
  it('es false sin endDate', () => {
    expect(isExhausted(monthly(d(2026, 1, 1)), d(2030, 1, 1))).toBe(false);
  });
});
