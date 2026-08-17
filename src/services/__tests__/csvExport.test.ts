import { csvField, toCsv, expensesToCsv, personalToCsv, csvFileName } from '../csvExport';
import type { Expense, Group, PersonalEntry, User } from '@/src/types/models';

const DAY = Date.UTC(2026, 7, 16);

const users: User[] = [
  { id: 'ua', name: 'Ana',  email: 'a@x.com', authProvider: 'google', createdAt: 0, updatedAt: 0, isDeleted: false },
  { id: 'ub', name: 'Bob',  email: 'b@x.com', authProvider: 'google', createdAt: 0, updatedAt: 0, isDeleted: false },
];
const groups = [{ id: 'g1', name: 'Viaje' } as Group];

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: 'e1', groupId: 'g1', description: 'Cena', amount: 10000, currency: 'ARS',
    paidById: 'ua', splitMode: 'equal',
    splits: [{ userId: 'ua', amount: 5000, isPaid: false }, { userId: 'ub', amount: 5000, isPaid: false }],
    category: 'food', date: DAY, createdAt: DAY, createdById: 'ua',
    deletionVotes: [], updatedAt: DAY, isDeleted: false,
    ...over,
  } as Expense;
}

describe('csvField (RFC 4180)', () => {
  it('deja pasar texto simple', () => {
    expect(csvField('Cena')).toBe('Cena');
  });
  it('entrecomilla si hay coma', () => {
    expect(csvField('Cena, postre')).toBe('"Cena, postre"');
  });
  it('duplica las comillas internas', () => {
    expect(csvField('El "Bodegón"')).toBe('"El ""Bodegón"""');
  });
  it('entrecomilla si hay salto de línea', () => {
    expect(csvField('a\nb')).toBe('"a\nb"');
  });
  it('null y undefined son celda vacía', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });
});

describe('toCsv', () => {
  it('separa por coma y termina las filas con CRLF', () => {
    const out = toCsv([['a', 'b'], ['1', '2']]);
    expect(out.endsWith('a,b\r\n1,2')).toBe(true);
  });
  it('arranca con BOM UTF-8 (si no, Excel rompe los acentos)', () => {
    expect(toCsv([['á']]).charCodeAt(0)).toBe(0xfeff);
  });
});

describe('expensesToCsv', () => {
  it('exporta una fila por gasto con encabezado', () => {
    const out = expensesToCsv({ expenses: [expense()], groups, users });
    const lines = out.split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Fecha');
    expect(lines[1]).toContain('Viaje');
    expect(lines[1]).toContain('Cena');
  });

  it('resuelve nombres en vez de ids', () => {
    const out = expensesToCsv({ expenses: [expense()], groups, users });
    expect(out).toContain('Ana');
    expect(out).not.toContain('ua,');
  });

  it('incluye el monto en crudo además del formateado', () => {
    const out = expensesToCsv({ expenses: [expense()], groups, users });
    expect(out).toContain('10000'); // menor unidad, sin ambigüedad de redondeo
  });

  it('NO exporta gastos borrados (tombstones)', () => {
    const out = expensesToCsv({
      expenses: [expense(), expense({ id: 'e2', description: 'Borrado', isDeleted: true })],
      groups, users,
    });
    expect(out).not.toContain('Borrado');
    expect(out.split('\r\n')).toHaveLength(2);
  });

  it('filtra por grupo cuando se pide', () => {
    const out = expensesToCsv({
      expenses: [expense(), expense({ id: 'e2', groupId: 'g2', description: 'Otro' })],
      groups, users, groupId: 'g1',
    });
    expect(out).not.toContain('Otro');
  });

  it('ordena por fecha ascendente', () => {
    const out = expensesToCsv({
      expenses: [
        expense({ id: 'e2', description: 'Tarde', date: DAY + 86400000 }),
        expense({ id: 'e1', description: 'Temprano', date: DAY }),
      ], groups, users,
    });
    expect(out.indexOf('Temprano')).toBeLessThan(out.indexOf('Tarde'));
  });

  it('una descripción con coma no rompe las columnas', () => {
    const out = expensesToCsv({ expenses: [expense({ description: 'Cena, postre y café' })], groups, users });
    expect(out).toContain('"Cena, postre y café"');
  });

  it('lista cuánto le tocó a cada participante', () => {
    const out = expensesToCsv({ expenses: [expense()], groups, users });
    expect(out).toContain('Ana');
    expect(out).toContain('Bob');
  });

  it('sin gastos devuelve solo el encabezado', () => {
    const out = expensesToCsv({ expenses: [], groups, users });
    expect(out.split('\r\n')).toHaveLength(1);
  });
});

describe('personalToCsv', () => {
  const entry = (over: Partial<PersonalEntry> = {}): PersonalEntry => ({
    id: 'p1', kind: 'expense', description: 'Café', amount: 500, currency: 'ARS',
    category: 'food', date: DAY, createdAt: DAY, updatedAt: DAY, isDeleted: false,
    ...over,
  } as PersonalEntry);

  it('distingue ingreso de gasto en palabras', () => {
    const out = personalToCsv([entry(), entry({ id: 'p2', kind: 'income', description: 'Sueldo' })]);
    expect(out).toContain('Gasto');
    expect(out).toContain('Ingreso');
  });

  it('no exporta borrados', () => {
    const out = personalToCsv([entry({ isDeleted: true, description: 'Fantasma' })]);
    expect(out).not.toContain('Fantasma');
  });
});

describe('csvFileName', () => {
  it('incluye prefijo y fecha', () => {
    expect(csvFileName('gastos', DAY)).toBe('splitp2p-gastos-2026-08-16.csv');
  });
});
