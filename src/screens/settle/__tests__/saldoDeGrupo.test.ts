import i18n from '@/src/i18n';
import { formatMoney } from '@/src/constants/currencies';
import type { CurrencyCode } from '@/src/constants/currencies';
import type { Expense, Group, Payment } from '@/src/types/models';
import {
  balancesEnMoneda, formatDate, hintDe, puedeGuardarSaldo,
} from '@/src/screens/settle/saldoDeGrupo';

/**
 * T-223: lógica pura que vivía dentro de `app/settle/new.tsx` (635 líneas).
 * Toca plata: montos en menor unidad (ADR-002), probados con monedas sin
 * decimales (CLP, PYG) y con decimales (USD, ARS).
 */

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['beto', 'ana'], currency: 'CLP',
  miembros: {}, createdAt: 0, createdById: 'beto', updatedAt: 0, isDeleted: false,
  ...over,
} as Group);

/** Beto pone `amount` y se reparte a medias. */
const gasto = (amount: number, currency: CurrencyCode, over: Partial<Expense> = {}): Expense => ({
  id: `e-${currency}-${amount}`, groupId: 'g1', description: 'x', amount, currency,
  paidById: 'beto', splitMode: 'equal',
  splits: [{ userId: 'ana', amount: amount / 2 }, { userId: 'beto', amount: amount / 2 }],
  memberIds: ['beto', 'ana'], category: 'other', date: 0, createdAt: 0,
  createdById: 'beto', updatedAt: 0, isDeleted: false, ...over,
} as Expense);

const pago = (amount: number, currency: CurrencyCode, over: Partial<Payment> = {}): Payment => ({
  id: `p-${currency}-${amount}`, groupId: 'g1', fromUserId: 'ana', toUserId: 'beto',
  amount, currency, date: 0, createdAt: 0, createdById: 'ana', updatedAt: 0,
  isDeleted: false, ...over,
} as Payment);

const saldo = (bs: { userId: string; amount: number }[], uid: string) =>
  bs.find(b => b.userId === uid)?.amount;

describe('balancesEnMoneda', () => {
  it('sin grupo no hay balances', () => {
    expect(balancesEnMoneda(undefined, [gasto(10_000, 'CLP')], [], 'CLP')).toEqual([]);
  });

  it('CLP (0 decimales): gastos menos lo ya pagado, en menor unidad', () => {
    const bs = balancesEnMoneda(grupo(), [gasto(10_000, 'CLP')], [pago(2_000, 'CLP')], 'CLP');
    expect(saldo(bs, 'ana')).toBe(-3_000);
    expect(saldo(bs, 'beto')).toBe(3_000);
  });

  it('PYG (0 decimales): montos grandes sin redondeos', () => {
    const bs = balancesEnMoneda(grupo({ currency: 'PYG' }), [gasto(150_000, 'PYG')], [], 'PYG');
    expect(saldo(bs, 'ana')).toBe(-75_000);
    expect(saldo(bs, 'beto')).toBe(75_000);
  });

  it('USD (2 decimales): centavos exactos y la otra moneda no se mezcla', () => {
    const bs = balancesEnMoneda(
      grupo({ currency: 'USD' }),
      [gasto(1_050, 'USD'), gasto(10_000, 'CLP')],
      [pago(25, 'USD')],
      'USD',
    );
    expect(saldo(bs, 'ana')).toBe(-500);
    expect(saldo(bs, 'beto')).toBe(500);
  });

  it('un miembro sin movimientos en esa moneda queda en 0', () => {
    const bs = balancesEnMoneda(grupo(), [gasto(10_000, 'CLP')], [], 'ARS');
    expect(bs.map(b => b.amount)).toEqual([0, 0]);
  });

  it('ignora gastos y pagos borrados y los de otro grupo', () => {
    const bs = balancesEnMoneda(
      grupo(),
      [gasto(10_000, 'CLP'), gasto(4_000, 'CLP', { isDeleted: true }), gasto(8_000, 'CLP', { groupId: 'g2' })],
      [pago(1_000, 'CLP', { isDeleted: true }), pago(2_000, 'CLP', { groupId: 'g2' })],
      'CLP',
    );
    expect(saldo(bs, 'ana')).toBe(-5_000);
  });
});

describe('hintDe', () => {
  const t = (k: string, o?: { amount?: string }) => `${k}|${o?.amount ?? ''}`;
  const bs = [{ userId: 'ana', amount: -5_000 }, { userId: 'beto', amount: 5_000 }, { userId: 'caro', amount: 0 }];

  it('al que le deben: hint_owed con el monto formateado', () => {
    expect(hintDe(bs, 'beto', 'CLP', t)).toBe(`settle.hint_owed|${formatMoney(5_000, 'CLP')}`);
  });

  it('el que debe: hint_owes con el valor absoluto', () => {
    expect(hintDe(bs, 'ana', 'PYG', t)).toBe(`settle.hint_owes|${formatMoney(5_000, 'PYG')}`);
  });

  it('con decimales formatea en la moneda pedida', () => {
    expect(hintDe([{ userId: 'x', amount: 1_234 }], 'x', 'USD', t)).toBe(`settle.hint_owed|${formatMoney(1_234, 'USD')}`);
  });

  it('saldo cero o persona desconocida: sin hint', () => {
    expect(hintDe(bs, 'caro', 'CLP', t)).toBeUndefined();
    expect(hintDe(bs, 'nadie', 'CLP', t)).toBeUndefined();
  });
});

describe('puedeGuardarSaldo', () => {
  const ok = { amount: 500, exceedsMax: false, fromId: 'ana', toId: 'beto', groupId: 'g1', grupoArchivado: false };

  it('caso feliz', () => {
    expect(puedeGuardarSaldo(ok)).toBe(true);
  });

  it('monto 0 o que excede el tope: no', () => {
    expect(puedeGuardarSaldo({ ...ok, amount: 0 })).toBe(false);
    expect(puedeGuardarSaldo({ ...ok, exceedsMax: true })).toBe(false);
  });

  it('falta alguien, es la misma persona, sin grupo o grupo archivado: no', () => {
    expect(puedeGuardarSaldo({ ...ok, fromId: '' })).toBe(false);
    expect(puedeGuardarSaldo({ ...ok, toId: '' })).toBe(false);
    expect(puedeGuardarSaldo({ ...ok, toId: 'ana' })).toBe(false);
    expect(puedeGuardarSaldo({ ...ok, groupId: '' })).toBe(false);
    expect(puedeGuardarSaldo({ ...ok, grupoArchivado: true })).toBe(false);
  });
});

describe('formatDate', () => {
  it('hoy y ayer con nombre traducido; el resto con fecha corta', () => {
    const hoy = new Date();
    const ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
    const antes = new Date(); antes.setDate(hoy.getDate() - 5);
    expect(formatDate(hoy)).toBe(i18n.t('common.today'));
    expect(formatDate(ayer)).toBe(i18n.t('common.yesterday'));
    expect(formatDate(antes)).toBe(antes.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }));
  });
});
