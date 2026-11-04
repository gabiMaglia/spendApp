import { repartoParejo } from '../repartoSaldo';

const b = (userId: string, amount: number) => ({ userId, amount });
const suma = (r: { amount: number }[]) => r.reduce((s, x) => s + x.amount, 0);

describe('repartoParejo (T-260): el sobrante de quien poco prestó se redistribuye', () => {
  it('caso de la auditoría: debo 1000 y 10, escribo 500 -> suma 500', () => {
    const r = repartoParejo([b('ana', 1_000), b('beto', 10)], 500);
    expect(suma(r)).toBe(500);
    expect(r).toEqual([b('ana', 490), b('beto', 10)]);
  });

  it('nadie cobra más de lo que se le debe y la suma cierra con varios topes', () => {
    const acreedores = [b('a', 1_000), b('b', 30), b('c', 10), b('d', 500)];
    const r = repartoParejo(acreedores, 700);
    expect(suma(r)).toBe(700);
    for (const x of r) {
      expect(x.amount).toBeLessThanOrEqual(acreedores.find(a => a.userId === x.userId)!.amount);
      expect(Number.isInteger(x.amount)).toBe(true);
    }
  });

  it('es determinista y cierra con resto impar', () => {
    const acreedores = [b('a', 1_000), b('b', 10), b('c', 1_000)];
    const r = repartoParejo(acreedores, 1_001);
    expect(suma(r)).toBe(1_001);
    expect(r).toEqual(repartoParejo(acreedores, 1_001));
  });

  it('disponible = deuda total - 1 sigue cerrando', () => {
    expect(suma(repartoParejo([b('a', 1_000), b('b', 10)], 1_009))).toBe(1_009);
  });
});
