import {
  leer, registrar, olvidarTopic, entradaCumplida, type AlmacenPort,
} from '../appliedSlices';

function memoria(): AlmacenPort {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k),
    set: (k, v) => { m.set(k, v); },
    delete: (k) => { m.delete(k); },
  };
}

describe('appliedSlices — unidades del núcleo (T-191 Task 3)', () => {
  it('leer devuelve null sin registro previo', () => {
    expect(leer(memoria(), 't1', 'sA', 'ck1')).toBeNull();
  });

  it('registrar persiste digest/seq/senderKey, leer los devuelve tal cual', () => {
    const a = memoria();
    registrar(a, 't1', 'sA', 'ck1', { digest: 'd1', seq: 5, senderKey: 'kA' });
    expect(leer(a, 't1', 'sA', 'ck1')).toEqual({ digest: 'd1', seq: 5, senderKey: 'kA' });
  });

  it('la clave es (topic, sender, ckey): mismo ckey de otro sender u otro topic es independiente', () => {
    const a = memoria();
    registrar(a, 't1', 'sA', 'ck1', { digest: 'dA', seq: 1, senderKey: 'kA' });
    registrar(a, 't1', 'sB', 'ck1', { digest: 'dB', seq: 1, senderKey: 'kB' });
    registrar(a, 't2', 'sA', 'ck1', { digest: 'dOtroTopic', seq: 1, senderKey: 'kA' });
    expect(leer(a, 't1', 'sA', 'ck1')?.digest).toBe('dA');
    expect(leer(a, 't1', 'sB', 'ck1')?.digest).toBe('dB');
    expect(leer(a, 't2', 'sA', 'ck1')?.digest).toBe('dOtroTopic');
  });

  it('olvidarTopic borra todo lo aplicado de ese topic, de cualquier sender, y no toca otros topics', () => {
    const a = memoria();
    registrar(a, 't1', 'sA', 'ck1', { digest: 'd', seq: 1, senderKey: 'kA' });
    registrar(a, 't1', 'sB', 'ck2', { digest: 'd', seq: 1, senderKey: 'kB' });
    registrar(a, 't2', 'sA', 'ck3', { digest: 'd', seq: 1, senderKey: 'kA' });

    olvidarTopic(a, 't1');

    expect(leer(a, 't1', 'sA', 'ck1')).toBeNull();
    expect(leer(a, 't1', 'sB', 'ck2')).toBeNull();
    expect(leer(a, 't2', 'sA', 'ck3')).toEqual({ digest: 'd', seq: 1, senderKey: 'kA' });
  });

  it('dato corrupto en el índice se trata como ausente, no tira', () => {
    const a = memoria();
    a.set('appliedSlicesIndice\u0000t1', 'no es json');
    expect(() => olvidarTopic(a, 't1')).not.toThrow();
  });
});

describe('entradaCumplida — cierre del manifiesto (spec §7/§8 C5(c))', () => {
  const entry = { ckey: 'ck1', digest: 'dig-actual' };

  it('cumplida si el digest llegó EN ESTE DRENAJE, sin necesitar nada aplicado antes', () => {
    expect(entradaCumplida(entry, 100, 'kSender', 'dig-actual', null)).toBe(true);
  });

  it('no cumplida si lo recibido este drenaje tiene OTRO digest (sobre corrupto/viejo bajo esa ckey)', () => {
    expect(entradaCumplida(entry, 100, 'kSender', 'dig-viejo', null)).toBe(false);
  });

  it('cumplida si ya estaba aplicada con el MISMO digest y la MISMA senderKey, sin haber llegado hoy', () => {
    const aplicada = { digest: 'dig-actual', seq: 50, senderKey: 'kSender' };
    expect(entradaCumplida(entry, 100, 'kSender', undefined, aplicada)).toBe(true);
  });

  it('no cumplida si la senderKey aplicada no coincide con la del manifiesto', () => {
    const aplicada = { digest: 'dig-actual', seq: 50, senderKey: 'OTRA-CLAVE' };
    expect(entradaCumplida(entry, 100, 'kSender', undefined, aplicada)).toBe(false);
  });

  it('cumplida si lo aplicado tiene seq MAYOR que el manifiesto, aunque el digest no coincida (publicación en curso cortada por cuota)', () => {
    const aplicada = { digest: 'dig-mas-nueva-todavia', seq: 150, senderKey: 'kSender' };
    expect(entradaCumplida(entry, 100, 'kSender', undefined, aplicada)).toBe(true);
  });

  it('no cumplida si lo aplicado tiene seq MENOR y digest distinto, y nada llegó hoy', () => {
    const aplicada = { digest: 'dig-vieja', seq: 50, senderKey: 'kSender' };
    expect(entradaCumplida(entry, 100, 'kSender', undefined, aplicada)).toBe(false);
  });

  it('no cumplida sin nada aplicado y nada recibido hoy', () => {
    expect(entradaCumplida(entry, 100, 'kSender', undefined, null)).toBe(false);
  });
});
