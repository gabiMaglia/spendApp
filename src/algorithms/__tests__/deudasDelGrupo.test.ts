import { deudasDelGrupo, deudaEntre, totalesDeUsuario } from '@/src/algorithms/deudasDelGrupo';
import { calculateBalancesByCurrency } from '@/src/algorithms/calculateBalances';
import type { Expense, Payment } from '@/src/types/models';

/**
 * T-225 (PO 2026-09-29): la deuda entre dos personas NO se compensa dentro del
 * grupo. Lo que me deben y lo que debo son dos hechos distintos (ADR-006 d1),
 * y cada uno baja sólo con su propio pago.
 */

const YO = 'yo';
const ANA = 'ana';
const BETO = 'beto';

let n = 0;
function gasto(paidById: string, amount: number, partes: Record<string, number>, extra: Partial<Expense> = {}): Expense {
  n++;
  return {
    id: `e${n}`, groupId: 'g', description: 'x', amount, currency: 'ARS',
    paidById, splitMode: 'custom', category: 'other', date: n, createdAt: n, createdById: paidById,
    splits: Object.entries(partes).map(([userId, a]) => ({ userId, amount: a, isPaid: false })),
    updatedAt: n, isDeleted: false, ...extra,
  } as unknown as Expense;
}
function pago(from: string, to: string, amount: number, extra: Partial<Payment> = {}): Payment {
  n++;
  return {
    id: `p${n}`, groupId: 'g', fromUserId: from, toUserId: to, amount, currency: 'ARS',
    date: n, createdAt: n, createdById: from, updatedAt: n, isDeleted: false, ...extra,
  } as unknown as Payment;
}

describe('deudasDelGrupo — el caso del PO', () => {
  // Cuatro gastos donde me deben 200 en total y uno donde debo 60.
  const gastos = [
    gasto(YO, 100, { [YO]: 50, [ANA]: 50 }),
    gasto(YO, 100, { [YO]: 50, [ANA]: 50 }),
    gasto(YO, 100, { [YO]: 50, [ANA]: 50 }),
    gasto(YO, 100, { [YO]: 50, [ANA]: 50 }),
    gasto(ANA, 120, { [YO]: 60, [ANA]: 60 }),
  ];

  it('muestra las dos direcciones sin compensar', () => {
    const d = deudasDelGrupo(gastos, [], [YO, ANA]);
    expect(deudaEntre(d, ANA, YO, 'ARS')).toBe(200);
    expect(deudaEntre(d, YO, ANA, 'ARS')).toBe(60);
    expect(totalesDeUsuario(d, YO)).toEqual([{ currency: 'ARS', owedToYou: 200, youOwe: 60 }]);
  });

  it('si pago todo lo que debo (60), quedo en 0 y me siguen debiendo 200', () => {
    const d = deudasDelGrupo(gastos, [pago(YO, ANA, 60)], [YO, ANA]);
    expect(totalesDeUsuario(d, YO)).toEqual([{ currency: 'ARS', owedToYou: 200, youOwe: 0 }]);
  });

  it('un pago parcial baja sólo su lado', () => {
    const d = deudasDelGrupo(gastos, [pago(ANA, YO, 150)], [YO, ANA]);
    expect(totalesDeUsuario(d, YO)).toEqual([{ currency: 'ARS', owedToYou: 50, youOwe: 60 }]);
  });

  it('cuando los dos pagan su lado, todo queda en cero', () => {
    const d = deudasDelGrupo(gastos, [pago(ANA, YO, 200), pago(YO, ANA, 60)], [YO, ANA]);
    expect(d).toEqual([]);
    expect(totalesDeUsuario(d, YO)).toEqual([]);
  });
});

describe('deudasDelGrupo — reglas', () => {
  it('un pago que se pasa deja el excedente como deuda inversa (invariante del neto)', () => {
    const d = deudasDelGrupo([gasto(ANA, 100, { [YO]: 50, [ANA]: 50 })], [pago(YO, ANA, 80)], [YO, ANA]);
    expect(deudaEntre(d, YO, ANA, 'ARS')).toBe(0);
    expect(deudaEntre(d, ANA, YO, 'ARS')).toBe(30);
  });

  it('ignora gastos y pagos borrados', () => {
    const d = deudasDelGrupo(
      [gasto(ANA, 100, { [YO]: 50, [ANA]: 50 }, { isDeleted: true })],
      [pago(YO, ANA, 50, { isDeleted: true })],
      [YO, ANA],
    );
    expect(d).toEqual([]);
  });

  it('separa por moneda y nunca mezcla', () => {
    const d = deudasDelGrupo(
      [gasto(ANA, 100, { [YO]: 50, [ANA]: 50 }), gasto(YO, 10, { [YO]: 5, [ANA]: 5 }, { currency: 'USD' } as Partial<Expense>)],
      [], [YO, ANA],
    );
    expect(deudaEntre(d, YO, ANA, 'ARS')).toBe(50);
    expect(deudaEntre(d, ANA, YO, 'USD')).toBe(5);
    expect(totalesDeUsuario(d, YO)).toEqual(expect.arrayContaining([
      { currency: 'ARS', owedToYou: 0, youOwe: 50 },
      { currency: 'USD', owedToYou: 5, youOwe: 0 },
    ]));
  });

  it('tres personas: cada uno le debe su parte a quien pagó', () => {
    const d = deudasDelGrupo([gasto(ANA, 90, { [YO]: 30, [ANA]: 30, [BETO]: 30 })], [], [YO, ANA, BETO]);
    expect(deudaEntre(d, YO, ANA, 'ARS')).toBe(30);
    expect(deudaEntre(d, BETO, ANA, 'ARS')).toBe(30);
    expect(deudaEntre(d, YO, BETO, 'ARS')).toBe(0);
  });

  it('varios pagadores: la parte de cada uno se reparte entre los que pagaron, exacta al centavo', () => {
    const g = gasto(ANA, 101, { [YO]: 33, [ANA]: 34, [BETO]: 34 }, {
      payers: [{ userId: ANA, amount: 51 }, { userId: BETO, amount: 50 }],
    } as Partial<Expense>);
    const d = deudasDelGrupo([g], [], [YO, ANA, BETO]);
    expect(deudaEntre(d, YO, ANA, 'ARS') + deudaEntre(d, YO, BETO, 'ARS')).toBe(33);
    const netos = calculateBalancesByCurrency([g], [], [YO, ANA, BETO]);
    for (const { userId, balances } of netos) {
      const t = totalesDeUsuario(d, userId).find(x => x.currency === 'ARS') ?? { owedToYou: 0, youOwe: 0 };
      expect(t.owedToYou - t.youOwe).toBe(balances.find(b => b.currency === 'ARS')?.amount ?? 0);
    }
  });

  it('un gasto de alguien que ya no está en el roster no genera deuda con esa persona', () => {
    const d = deudasDelGrupo([gasto('ex', 100, { [YO]: 50, ex: 50 })], [], [YO, ANA]);
    expect(d).toEqual([]);
  });

  it('sin gastos ni pagos no hay deudas', () => {
    expect(deudasDelGrupo([], [], [YO, ANA])).toEqual([]);
  });
});

describe('invariante: Σ me deben − Σ debo = neto de siempre (propiedad)', () => {
  // Generador determinístico (sin Math.random: el test tiene que ser reproducible).
  let semilla = 7;
  const azar = (max: number) => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla % max; };
  const gente = [YO, ANA, BETO, 'caro'];

  it.each(Array.from({ length: 40 }, (_, i) => i))('escenario %i', () => {
    const gastos: Expense[] = [];
    const pagos: Payment[] = [];
    for (let k = 0; k < 1 + azar(8); k++) {
      const participantes = gente.filter(() => azar(3) > 0);
      if (participantes.length === 0) continue;
      const partes: Record<string, number> = {};
      let total = 0;
      for (const p of participantes) { partes[p] = 1 + azar(500); total += partes[p]; }
      const pagador = gente[azar(gente.length)];
      const multi = azar(3) === 0;
      const otro = gente[(gente.indexOf(pagador) + 1) % gente.length];
      const a = Math.floor(total / 3);
      gastos.push(gasto(pagador, total, partes, multi
        ? { payers: [{ userId: pagador, amount: total - a }, { userId: otro, amount: a }] } as Partial<Expense>
        : {}));
    }
    for (let k = 0; k < azar(4); k++) {
      const from = gente[azar(gente.length)];
      const to = gente[(gente.indexOf(from) + 1 + azar(3)) % gente.length];
      pagos.push(pago(from, to, 1 + azar(400)));
    }
    const d = deudasDelGrupo(gastos, pagos, gente);
    expect(d.every(x => x.monto > 0)).toBe(true);
    for (const { userId, balances } of calculateBalancesByCurrency(gastos, pagos, gente)) {
      const t = totalesDeUsuario(d, userId).find(x => x.currency === 'ARS') ?? { owedToYou: 0, youOwe: 0 };
      expect(t.owedToYou - t.youOwe).toBe(balances.find(b => b.currency === 'ARS')?.amount ?? 0);
    }
  });
});
