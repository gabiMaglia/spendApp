import {
  hasSettledUp, unsettledCurrencies, planAbsorption, planSettlesLeaver,
} from '../absorbBalance';

const ANA = 'ua', BOB = 'ub', CAR = 'uc';

describe('hasSettledUp', () => {
  it('sin saldo en ninguna moneda, puede irse', () => {
    expect(hasSettledUp([{ currency: 'ARS', amount: 0 }])).toBe(true);
    expect(hasSettledUp([])).toBe(true);
  });

  it('si debe, no puede irse', () => {
    expect(hasSettledUp([{ currency: 'ARS', amount: -5000 }])).toBe(false);
  });

  // También bloquea si LE DEBEN: irse regalando plata debe ser una decisión
  // explícita, no un descuido.
  it('si le deben, tampoco', () => {
    expect(hasSettledUp([{ currency: 'ARS', amount: 5000 }])).toBe(false);
  });

  it('basta con una moneda abierta', () => {
    expect(hasSettledUp([
      { currency: 'ARS', amount: 0 }, { currency: 'USD', amount: -100 },
    ])).toBe(false);
    expect(unsettledCurrencies([
      { currency: 'ARS', amount: 0 }, { currency: 'USD', amount: -100 },
    ])).toEqual(['USD']);
  });
});

describe('planAbsorption — el que DEBE se va', () => {
  const debe = [{ currency: 'ARS' as const, amount: -6000 }];

  it('reparte la deuda en partes iguales', () => {
    const plan = planAbsorption(ANA, debe, [BOB, CAR]);

    expect(plan).toHaveLength(2);
    plan.forEach(p => {
      expect(p.fromUserId).toBe(ANA);   // paga el que se va
      expect(p.amount).toBe(3000);
    });
  });

  it('deja al que se va exactamente en cero', () => {
    expect(planSettlesLeaver(planAbsorption(ANA, debe, [BOB, CAR]), ANA, debe)).toBe(true);
  });

  it('todo a una sola persona', () => {
    const plan = planAbsorption(ANA, debe, [BOB]);
    expect(plan).toHaveLength(1);
    expect(plan[0]!).toMatchObject({ fromUserId: ANA, toUserId: BOB, amount: 6000 });
  });

  it('por porcentajes distintos, como al crear un gasto', () => {
    const plan = planAbsorption(ANA, debe, [BOB, CAR], 'percentage', [75, 25]);

    const porUsuario = Object.fromEntries(plan.map(p => [p.toUserId, p.amount]));
    expect(porUsuario[BOB]).toBe(4500);
    expect(porUsuario[CAR]).toBe(1500);
  });

  // El resto de la división no puede evaporarse: si no cierra, al que se fue le
  // queda saldo fantasma de una unidad.
  it('un monto que no divide redondo igual cierra exacto', () => {
    const raro = [{ currency: 'ARS' as const, amount: -10_001 }];
    const plan = planAbsorption(ANA, raro, [BOB, CAR]);

    expect(plan.reduce((t, p) => t + p.amount, 0)).toBe(10_001);
    expect(planSettlesLeaver(plan, ANA, raro)).toBe(true);
  });
});

describe('planAbsorption — al que se va LE DEBEN', () => {
  const leDeben = [{ currency: 'ARS' as const, amount: 6000 }];

  it('los pagos van HACIA el que se va: se les perdona la deuda', () => {
    const plan = planAbsorption(ANA, leDeben, [BOB, CAR]);

    plan.forEach(p => expect(p.toUserId).toBe(ANA));
    expect(plan.map(p => p.fromUserId).sort()).toEqual([BOB, CAR]);
  });

  it('también lo deja en cero', () => {
    expect(planSettlesLeaver(planAbsorption(ANA, leDeben, [BOB, CAR]), ANA, leDeben)).toBe(true);
  });
});

describe('multi-moneda', () => {
  // Las monedas nunca se mezclan (regla de negocio #7).
  const mixto = [
    { currency: 'ARS' as const, amount: -6000 },
    { currency: 'USD' as const, amount: 300 },
  ];

  it('genera pagos por cada moneda, en su propia dirección', () => {
    const plan = planAbsorption(ANA, mixto, [BOB, CAR]);

    const ars = plan.filter(p => p.currency === 'ARS');
    const usd = plan.filter(p => p.currency === 'USD');

    expect(ars.every(p => p.fromUserId === ANA)).toBe(true); // debe pesos
    expect(usd.every(p => p.toUserId === ANA)).toBe(true);   // le deben dólares
  });

  it('lo deja en cero en TODAS las monedas', () => {
    expect(planSettlesLeaver(planAbsorption(ANA, mixto, [BOB, CAR]), ANA, mixto)).toBe(true);
  });

  it('ignora las monedas ya saldadas', () => {
    const plan = planAbsorption(ANA, [
      { currency: 'ARS', amount: 0 }, { currency: 'USD', amount: -100 },
    ], [BOB]);

    expect(plan.every(p => p.currency === 'USD')).toBe(true);
  });
});

describe('bordes', () => {
  it('sin absorbentes no genera nada (último miembro del grupo)', () => {
    expect(planAbsorption(ANA, [{ currency: 'ARS', amount: -100 }], [])).toEqual([]);
  });

  it('saldo cero no genera pagos', () => {
    expect(planAbsorption(ANA, [{ currency: 'ARS', amount: 0 }], [BOB])).toEqual([]);
  });

  it('no genera pagos de importe cero', () => {
    const plan = planAbsorption(ANA, [{ currency: 'ARS', amount: -100 }], [BOB, CAR], 'percentage', [100, 0]);
    expect(plan.every(p => p.amount > 0)).toBe(true);
  });

  it('planSettlesLeaver detecta un plan que NO cierra', () => {
    const balances = [{ currency: 'ARS' as const, amount: -6000 }];
    const incompleto = [{ fromUserId: ANA, toUserId: BOB, amount: 5000, currency: 'ARS' as const }];
    expect(planSettlesLeaver(incompleto, ANA, balances)).toBe(false);
  });
});
