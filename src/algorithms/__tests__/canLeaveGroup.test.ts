import { canLeaveGroup, hasAllApprovals } from '../canLeaveGroup';

const BOB = 'ub', CAR = 'uc';

describe('canLeaveGroup', () => {
  it('sin saldo se va libremente', () => {
    expect(canLeaveGroup([{ currency: 'ARS', amount: 0 }], [BOB])).toEqual({ kind: 'free' });
  });

  it('con deuda exige absorción y la aprobación de TODOS los demás', () => {
    const v = canLeaveGroup([{ currency: 'ARS', amount: -5000 }], [BOB, CAR]);

    expect(v.kind).toBe('needs_absorption');
    if (v.kind === 'needs_absorption') {
      expect(v.approversNeeded).toEqual([BOB, CAR]);
      expect(v.currencies).toEqual(['ARS']);
    }
  });

  it('si le deben, también exige aprobación (irse regalando plata es una decisión)', () => {
    expect(canLeaveGroup([{ currency: 'ARS', amount: 5000 }], [BOB]).kind).toBe('needs_absorption');
  });

  // No hay a quién pasarle el saldo: ofrecer "salir" acá sería mentir.
  it('último miembro con saldo: no hay salida posible', () => {
    const v = canLeaveGroup([{ currency: 'ARS', amount: -5000 }], []);
    expect(v.kind).toBe('last_member_with_balance');
  });

  it('último miembro SIN saldo sí puede irse', () => {
    expect(canLeaveGroup([{ currency: 'ARS', amount: 0 }], []).kind).toBe('free');
  });

  it('lista todas las monedas con saldo abierto', () => {
    const v = canLeaveGroup([
      { currency: 'ARS', amount: -100 }, { currency: 'USD', amount: 50 }, { currency: 'EUR', amount: 0 },
    ], [BOB]);
    if (v.kind === 'needs_absorption') expect(v.currencies).toEqual(['ARS', 'USD']);
  });
});

describe('hasAllApprovals', () => {
  it('falta uno ⇒ no alcanza', () => {
    expect(hasAllApprovals([BOB, CAR], [BOB])).toBe(false);
  });

  it('están todos ⇒ alcanza', () => {
    expect(hasAllApprovals([BOB, CAR], [CAR, BOB])).toBe(true);
  });

  it('aprobaciones de más no molestan', () => {
    expect(hasAllApprovals([BOB], [BOB, 'ux'])).toBe(true);
  });

  it('sin aprobadores necesarios, alcanza trivialmente', () => {
    expect(hasAllApprovals([], [])).toBe(true);
  });
});
