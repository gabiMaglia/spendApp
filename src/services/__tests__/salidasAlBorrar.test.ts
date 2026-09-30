import { gruposParaSalir } from '../salidasAlBorrar';
import type { Group, Expense, Payment } from '@/src/types/models';

/**
 * T-187 · Qué grupos abandona quien borra la cuenta: sólo aquellos donde no
 * tiene deuda viva en ninguna dirección ni moneda (T-228). Donde tiene
 * saldo distinto de cero, el grupo lo sigue viendo (como «Cuenta borrada») con
 * la deuda visible; salir ahí le rompería las cuentas a los demás (regla #3).
 */

function miembros(...ids: string[]): Group['miembros'] {
  return Object.fromEntries(ids.map((id, i) => [id, { estado: 'in' as const, at: i }]));
}

function group(id: string, over: Partial<Group> = {}): Group {
  return {
    id, updatedAt: 0, isDeleted: false, name: `G-${id}`, memberIds: ['u1', 'u2'],
    miembros: miembros('u1', 'u2'), currency: 'ARS', createdAt: 0, createdById: 'u1',
    ...over,
  };
}

function expense(id: string, groupId: string, over: Partial<Expense> = {}): Expense {
  return {
    id, updatedAt: 0, isDeleted: false, groupId, description: `E-${id}`,
    amount: 1000, currency: 'ARS', paidById: 'u1',
    splits: [{ userId: 'u1', amount: 500, isPaid: false }, { userId: 'u2', amount: 500, isPaid: false }],
    splitMode: 'equal', category: 'other', date: 0, createdAt: 0, createdById: 'u1',
    ...over,
  };
}

function payment(id: string, groupId: string, over: Partial<Payment> = {}): Payment {
  return {
    id, updatedAt: 0, isDeleted: false, groupId, fromUserId: 'u2', toUserId: 'u1',
    amount: 500, currency: 'ARS', date: 0, createdAt: 0, createdById: 'u2',
    ...over,
  };
}

describe('gruposParaSalir', () => {
  it('D1 · saldo 0 en todas las monedas (deuda saldada con un pago) ⇒ sale', () => {
    // u1 pagó 1000 repartido 500/500; u2 le devolvió los 500 que debía.
    const groups = [group('g1')];
    const expenses = [expense('e1', 'g1')];
    const payments = [payment('p1', 'g1')];

    expect(gruposParaSalir('u1', groups, expenses, payments)).toEqual(['g1']);
  });

  it('D2 · saldo distinto de cero en alguna moneda ⇒ NO sale', () => {
    // Sin el pago que salda la deuda: u2 todavía le debe 500 a u1.
    const groups = [group('g1')];
    const expenses = [expense('e1', 'g1')];
    const payments: Payment[] = [];

    expect(gruposParaSalir('u1', groups, expenses, payments)).toEqual([]);
  });

  it('D3 · soy el único miembro del grupo ⇒ sale igual (queda vacío, nadie lo ve)', () => {
    const groups = [group('g1', { memberIds: ['u1'], miembros: miembros('u1') })];
    const expenses: Expense[] = [];
    const payments: Payment[] = [];

    expect(gruposParaSalir('u1', groups, expenses, payments)).toEqual(['g1']);
  });

  it('no sale de un grupo del que ya no es miembro', () => {
    const groups = [group('g1', { memberIds: ['u2'], miembros: miembros('u2') })];
    expect(gruposParaSalir('u1', groups, [], [])).toEqual([]);
  });

  it('ignora grupos borrados (tombstone)', () => {
    const groups = [group('g1', { isDeleted: true })];
    expect(gruposParaSalir('u1', groups, [], [])).toEqual([]);
  });

  it('lista vacía de grupos ⇒ lista vacía', () => {
    expect(gruposParaSalir('u1', [], [], [])).toEqual([]);
  });

  it('con varios grupos, devuelve sólo los saldados', () => {
    const groups = [group('g1'), group('g2')];
    const expenses = [expense('e1', 'g1'), expense('e2', 'g2')];
    const payments = [payment('p1', 'g1')]; // sólo g1 se salda
    expect(gruposParaSalir('u1', groups, expenses, payments)).toEqual(['g1']);
  });
  it('D4 · deudas cruzadas con neto 0 ⇒ NO sale (T-228: cualquier deuda viva bloquea)', () => {
    const groups = [group('g1')];
    const expenses = [expense('e1', 'g1'), expense('e2', 'g1', { paidById: 'u2' })];
    expect(gruposParaSalir('u1', groups, expenses, [])).toEqual([]);
  });

  it('D5 · debo algo ⇒ NO sale', () => {
    const groups = [group('g1')];
    const expenses = [expense('e1', 'g1', { paidById: 'u2' })];
    expect(gruposParaSalir('u1', groups, expenses, [])).toEqual([]);
  });
});
