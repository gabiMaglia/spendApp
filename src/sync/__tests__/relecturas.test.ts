import { permite, _reset } from '../relay/relecturas';

describe('relecturas — presupuesto acotado (T-191 Task 3, spec §7/§8 C6)', () => {
  beforeEach(() => _reset());

  it('permite la primera relectura de una terna (topic, sender, seqManifiesto)', () => {
    expect(permite('t1', 'sA', 100)).toBe(true);
  });

  it('no permite una segunda relectura para la MISMA terna', () => {
    expect(permite('t1', 'sA', 100)).toBe(true);
    expect(permite('t1', 'sA', 100)).toBe(false);
    expect(permite('t1', 'sA', 100)).toBe(false); // sigue en false, no se reinicia solo
  });

  it('un manifiesto con OTRO seq abre presupuesto nuevo, para el mismo topic/sender', () => {
    expect(permite('t1', 'sA', 100)).toBe(true);
    expect(permite('t1', 'sA', 100)).toBe(false);
    expect(permite('t1', 'sA', 200)).toBe(true); // manifiesto nuevo: cupo nuevo
  });

  it('el presupuesto es independiente por topic y por sender', () => {
    expect(permite('t1', 'sA', 100)).toBe(true);
    expect(permite('t2', 'sA', 100)).toBe(true); // otro topic
    expect(permite('t1', 'sB', 100)).toBe(true); // otro sender
  });
});
