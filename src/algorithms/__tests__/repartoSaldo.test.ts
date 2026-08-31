import {
  acreedoresDe, totalAdeudado, repartoParejo, repartoValido, pagosDelReparto,
} from '../repartoSaldo';

const b = (userId: string, amount: number) => ({ userId, amount });

describe('acreedoresDe', () => {
  it('lista a quienes les debo, de mayor a menor', () => {
    const r = acreedoresDe([b('yo', -800), b('ana', 500), b('beto', 300)], 'yo');
    expect(r.map(a => a.userId)).toEqual(['ana', 'beto']);
  });

  it('si no debo nada, no hay a quien pagarle', () => {
    expect(acreedoresDe([b('yo', 500), b('ana', -500)], 'yo')).toEqual([]);
  });

  it('no me incluyo a mi mismo', () => {
    const r = acreedoresDe([b('yo', -500), b('ana', 500)], 'yo');
    expect(r.some(a => a.userId === 'yo')).toBe(false);
  });

  it('el orden desempata por id: estable entre renders', () => {
    const r = acreedoresDe([b('yo', -600), b('zeta', 300), b('ana', 300)], 'yo');
    expect(r.map(a => a.userId)).toEqual(['ana', 'zeta']);
  });
});

describe('repartoParejo', () => {
  const acreedores = [{ userId: 'ana', amount: 600 }, { userId: 'beto', amount: 400 }];

  it('si alcanza para todos, cada uno cobra lo suyo COMPLETO', () => {
    expect(repartoParejo(acreedores, 1_000)).toEqual(acreedores);
  });

  it('si sobra, tampoco se le paga de mas a nadie', () => {
    expect(repartoParejo(acreedores, 5_000)).toEqual(acreedores);
  });

  it('si no alcanza, reparte parejo', () => {
    expect(repartoParejo(acreedores, 400)).toEqual([
      { userId: 'ana', amount: 200 }, { userId: 'beto', amount: 200 },
    ]);
  });

  it('la suma da EXACTO aunque no divida justo', () => {
    // 401 entre 2 no es entero: el centavo tiene que ir a alguien, no perderse.
    const r = repartoParejo(acreedores, 401);
    expect(r.reduce((s, x) => s + x.amount, 0)).toBe(401);
  });

  it('el resto va al que mas presto, que es lo defendible', () => {
    const r = repartoParejo(acreedores, 401);
    expect(r.find(x => x.userId === 'ana')!.amount).toBe(201);
  });

  it('nunca le paga a alguien mas de lo que se le debe', () => {
    // Con un acreedor chico, el parejo lo desbordaria.
    const r = repartoParejo([{ userId: 'ana', amount: 900 }, { userId: 'beto', amount: 50 }], 800);
    expect(r.find(x => x.userId === 'beto')!.amount).toBeLessThanOrEqual(50);
  });

  it('sin plata no reparte nada', () => {
    expect(repartoParejo(acreedores, 0)).toEqual([]);
  });
});

describe('repartoValido', () => {
  const acreedores = [{ userId: 'ana', amount: 600 }, { userId: 'beto', amount: 400 }];

  it('un reparto dentro de lo disponible y lo adeudado vale', () => {
    expect(repartoValido([{ userId: 'ana', amount: 500 }], acreedores, 1_000)).toEqual({ ok: true });
  });

  it('no se puede repartir mas de lo que se tiene', () => {
    expect(repartoValido([{ userId: 'ana', amount: 600 }], acreedores, 500))
      .toEqual({ ok: false, motivo: 'excede_disponible' });
  });

  it('no se le puede pagar a alguien MAS de lo que se le debe', () => {
    // Pagarle de mas no salda: mueve la deuda al otro lado y deja al usuario
    // acreedor sin haberlo pedido.
    expect(repartoValido([{ userId: 'beto', amount: 900 }], acreedores, 1_000))
      .toEqual({ ok: false, motivo: 'excede_deuda' });
  });

  it('un reparto vacio no vale', () => {
    expect(repartoValido([], acreedores, 1_000)).toEqual({ ok: false, motivo: 'vacio' });
  });
});

describe('pagosDelReparto', () => {
  it('genera un pago por acreedor, siempre desde mi', () => {
    const r = pagosDelReparto(
      [{ userId: 'ana', amount: 600 }, { userId: 'beto', amount: 400 }], 'yo', 'g1', 'ARS',
    );
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ fromUserId: 'yo', toUserId: 'ana', amount: 600, groupId: 'g1' });
  });

  it('descarta los de monto cero: un pago de nada no es un pago', () => {
    const r = pagosDelReparto([{ userId: 'ana', amount: 0 }], 'yo', 'g1', 'ARS');
    expect(r).toEqual([]);
  });
});

describe('totalAdeudado', () => {
  it('suma lo que debo a todos', () => {
    expect(totalAdeudado([{ userId: 'a', amount: 600 }, { userId: 'b', amount: 400 }])).toBe(1_000);
  });
});
