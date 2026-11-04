import { registrarCubo, publicadoMasViejoEn, olvidarCubo, type AlmacenPort } from '../sliceLedger';

function memoria(): AlmacenPort {
  const m = new Map<string, string>();
  return { get: k => m.get(k), set: (k, v) => { m.set(k, v); }, delete: k => { m.delete(k); } };
}

describe('publicadoMasViejoEn (T-267)', () => {
  it('sin registros devuelve null', () => {
    expect(publicadoMasViejoEn(memoria(), 't', 'd1')).toBeNull();
  });

  it('devuelve el publicadaEn MÁS VIEJO de los cubos de este aparato en el topic', () => {
    const a = memoria();
    registrarCubo(a, 't', 'd1', 'ck1', 'x', 5_000);
    registrarCubo(a, 't', 'd1', 'ck2', 'y', 1_000);
    expect(publicadoMasViejoEn(a, 't', 'd1')).toBe(1_000);
  });

  it('ignora cubos de otro aparato o de otro topic', () => {
    const a = memoria();
    registrarCubo(a, 't', 'd2', 'ck1', 'x', 1);
    registrarCubo(a, 'otro', 'd1', 'ck1', 'x', 2);
    registrarCubo(a, 't', 'd1', 'ck9', 'x', 9_000);
    expect(publicadoMasViejoEn(a, 't', 'd1')).toBe(9_000);
  });

  it('un cubo olvidado deja de contar', () => {
    const a = memoria();
    registrarCubo(a, 't', 'd1', 'ck1', 'x', 1);
    olvidarCubo(a, 't', 'd1', 'ck1');
    expect(publicadoMasViejoEn(a, 't', 'd1')).toBeNull();
  });
});
