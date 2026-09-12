import { contactosConHistorial } from '@/src/algorithms/historialConContacto';
import type { Expense, Group, Payment } from '@/src/types/models';

/**
 * **Qué contactos tienen historial económico conmigo** (pedido del PO, 2026-09-12).
 *
 * En la lista de Contactos, un saldo en cero se mostraba como «Saldado» aunque nunca
 * hubieran compartido un gasto: un contacto recién agregado por QR aparecía «al día»
 * de algo que no existió. «Saldado» sólo dice algo cuando HUBO cuentas.
 *
 * Las reglas son las del saldo (`useGlobalPersonBalances`) a propósito: si el saldo
 * ignora un grupo, el historial también. Si no, la fila podría decir «Saldado» por un
 * grupo cuyo saldo no se muestra en ningún lado.
 */

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Asado', memberIds: ['yo', 'beto', 'caro'], currency: 'ARS',
  createdAt: 0, createdById: 'yo', deletionVotes: [], updatedAt: 0, isDeleted: false,
  ...over,
} as Group);

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Carne', amount: 1000, currency: 'ARS',
  paidById: 'yo', splits: [{ userId: 'yo', amount: 500, isPaid: false }, { userId: 'beto', amount: 500, isPaid: false }],
  createdById: 'yo', createdAt: 0, updatedAt: 0, isDeleted: false, deletionVotes: [],
  ...over,
} as Expense);

const pago = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', groupId: 'g1', fromUserId: 'beto', toUserId: 'yo', amount: 500, currency: 'ARS',
  createdAt: 0, updatedAt: 0, isDeleted: false,
  ...over,
} as Payment);

const con = (args: { groups?: Group[]; expenses?: Expense[]; payments?: Payment[] }) =>
  contactosConHistorial('yo', args.groups ?? [grupo()], args.expenses ?? [], args.payments ?? []);

describe('contactosConHistorial', () => {
  it('sin gastos ni pagos nadie tiene historial — el contacto recién agregado', () => {
    expect(con({}).size).toBe(0);
  });

  it('un gasto donde participamos los dos cuenta, aunque ya esté saldado', () => {
    expect(con({ expenses: [gasto()] }).has('beto')).toBe(true);
  });

  it('cuenta también si el contacto sólo PAGÓ y yo sólo estoy en la división', () => {
    const e = gasto({ paidById: 'beto', splits: [{ userId: 'yo', amount: 1000, isPaid: false }] });
    expect(con({ expenses: [e] }).has('beto')).toBe(true);
  });

  it('cuenta con varios pagadores (`payers`), no sólo con `paidById`', () => {
    const e = gasto({
      paidById: 'caro',
      payers: [{ userId: 'caro', amount: 500 }, { userId: 'beto', amount: 500 }],
      splits: [{ userId: 'yo', amount: 1000, isPaid: false }],
    });
    const r = con({ expenses: [e] });
    expect(r.has('beto')).toBe(true);
    expect(r.has('caro')).toBe(true);
  });

  it('un gasto del mismo grupo entre OTROS dos no me da historial con ellos', () => {
    const e = gasto({ paidById: 'beto', splits: [{ userId: 'caro', amount: 1000, isPaid: false }] });
    const r = con({ expenses: [e] });
    expect(r.has('beto')).toBe(false);
    expect(r.has('caro')).toBe(false);
  });

  it('un gasto borrado no cuenta: si todo se borró, no hubo cuentas que saldar', () => {
    expect(con({ expenses: [gasto({ isDeleted: true })] }).has('beto')).toBe(false);
  });

  it('un grupo borrado no cuenta, igual que en el saldo', () => {
    expect(con({ groups: [grupo({ isDeleted: true })], expenses: [gasto()] }).has('beto')).toBe(false);
  });

  it('un grupo del que no soy parte no cuenta, igual que en el saldo', () => {
    const ajeno = grupo({ memberIds: ['beto', 'caro'] });
    expect(con({ groups: [ajeno], expenses: [gasto()] }).has('beto')).toBe(false);
  });

  it('un gasto de un grupo que no existe localmente no cuenta', () => {
    expect(con({ groups: [], expenses: [gasto()] }).has('beto')).toBe(false);
  });

  it('un saldado entre nosotros cuenta, en cualquiera de las dos direcciones', () => {
    expect(con({ payments: [pago()] }).has('beto')).toBe(true);
    expect(con({ payments: [pago({ fromUserId: 'yo', toUserId: 'beto' })] }).has('beto')).toBe(true);
  });

  it('un saldado borrado no cuenta', () => {
    expect(con({ payments: [pago({ isDeleted: true })] }).has('beto')).toBe(false);
  });

  it('un saldado RECHAZADO en un grupo consensuado no cuenta: el pago nunca existió', () => {
    const consenso = grupo({ deletionMode: 'consensus' } as Partial<Group>);
    const rechazado = pago({
      createdById: 'beto',
      confirmations: [{ userId: 'yo', confirmedAt: 1, action: 'reject' }],
    } as Partial<Payment>);
    expect(con({ groups: [consenso], payments: [rechazado] }).has('beto')).toBe(false);
  });

  it('un saldado entre otros dos no me da historial con ninguno', () => {
    const r = con({ payments: [pago({ fromUserId: 'beto', toUserId: 'caro' })] });
    expect(r.size).toBe(0);
  });

  it('yo no figuro como contacto con historial conmigo mismo', () => {
    expect(con({ expenses: [gasto()] }).has('yo')).toBe(false);
  });
});
