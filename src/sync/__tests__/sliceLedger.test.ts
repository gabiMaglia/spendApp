import {
  leerCubo, registrarCubo, olvidarCubo, ckeysDelTopic,
  profundidad, subirProfundidad, olvidarTopic, type AlmacenPort,
} from '../relay/sliceLedger';

/** Puerto de almacenamiento en memoria — mismo contrato que `adaptador.almacen`. */
function memoria(): AlmacenPort {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k),
    set: (k, v) => { m.set(k, v); },
    delete: (k) => { m.delete(k); },
  };
}

describe('sliceLedger — unidades del núcleo (T-191 Task 2)', () => {
  it('leerCubo devuelve null sin registro previo', () => {
    expect(leerCubo(memoria(), 't1', 'd1', 'ck1')).toBeNull();
  });

  it('registrarCubo persiste digest + publicadaEn, leerCubo los devuelve tal cual', () => {
    const a = memoria();
    registrarCubo(a, 't1', 'd1', 'ck1', 'digest-x', 1_000);
    expect(leerCubo(a, 't1', 'd1', 'ck1')).toEqual({ digest: 'digest-x', publicadaEn: 1_000 });
  });

  it('re-registrar la misma ckey pisa la entrada anterior, sin duplicarla en el índice', () => {
    const a = memoria();
    registrarCubo(a, 't1', 'd1', 'ck1', 'v1', 1_000);
    registrarCubo(a, 't1', 'd1', 'ck1', 'v2', 2_000);
    expect(leerCubo(a, 't1', 'd1', 'ck1')).toEqual({ digest: 'v2', publicadaEn: 2_000 });
    expect(ckeysDelTopic(a, 't1', 'd1')).toEqual(['ck1']);
  });

  it('la clave es (topic, deviceId, ckey): mismo ckey en otro topic o dispositivo es independiente', () => {
    const a = memoria();
    registrarCubo(a, 'topicA', 'd1', 'ck1', 'v-topicA', 1_000);
    registrarCubo(a, 'topicB', 'd1', 'ck1', 'v-topicB', 1_000);
    registrarCubo(a, 'topicA', 'd2', 'ck1', 'v-otroDevice', 1_000);
    expect(leerCubo(a, 'topicA', 'd1', 'ck1')?.digest).toBe('v-topicA');
    expect(leerCubo(a, 'topicB', 'd1', 'ck1')?.digest).toBe('v-topicB');
    expect(leerCubo(a, 'topicA', 'd2', 'ck1')?.digest).toBe('v-otroDevice');
  });

  it('ckeysDelTopic sólo devuelve las del deviceId pedido', () => {
    const a = memoria();
    registrarCubo(a, 't1', 'mio', 'ck1', 'v', 1);
    registrarCubo(a, 't1', 'mio', 'ck2', 'v', 1);
    registrarCubo(a, 't1', 'otro-device', 'ck3', 'v', 1);
    expect(ckeysDelTopic(a, 't1', 'mio').sort()).toEqual(['ck1', 'ck2']);
    expect(ckeysDelTopic(a, 't1', 'otro-device')).toEqual(['ck3']);
  });

  it('olvidarCubo borra la entrada y la saca del índice', () => {
    const a = memoria();
    registrarCubo(a, 't1', 'd1', 'ck1', 'v', 1);
    registrarCubo(a, 't1', 'd1', 'ck2', 'v', 1);
    olvidarCubo(a, 't1', 'd1', 'ck1');
    expect(leerCubo(a, 't1', 'd1', 'ck1')).toBeNull();
    expect(ckeysDelTopic(a, 't1', 'd1')).toEqual(['ck2']);
  });

  it('profundidad default es 1 sin registro previo', () => {
    expect(profundidad(memoria(), 't1', 'expenses')).toBe(1);
  });

  it('subirProfundidad persiste, y es por (topic, campo) — no se mezcla entre campos ni topics', () => {
    const a = memoria();
    subirProfundidad(a, 't1', 'expenses', 2);
    expect(profundidad(a, 't1', 'expenses')).toBe(2);
    expect(profundidad(a, 't1', 'comments')).toBe(1);
    expect(profundidad(a, 't2', 'expenses')).toBe(1);
  });

  it('olvidarTopic borra TODOS los cubos (cualquier deviceId) y todas las profundidades de ese topic', () => {
    const a = memoria();
    registrarCubo(a, 't1', 'd1', 'ck1', 'v', 1);
    registrarCubo(a, 't1', 'd2-otro-aparato', 'ck2', 'v', 1);
    registrarCubo(a, 't2', 'd1', 'ck3', 'v', 1); // otro topic: no se toca
    subirProfundidad(a, 't1', 'expenses', 3);
    subirProfundidad(a, 't1', 'comments', 2);
    subirProfundidad(a, 't2', 'expenses', 2); // otro topic: no se toca

    olvidarTopic(a, 't1');

    expect(leerCubo(a, 't1', 'd1', 'ck1')).toBeNull();
    expect(leerCubo(a, 't1', 'd2-otro-aparato', 'ck2')).toBeNull();
    expect(ckeysDelTopic(a, 't1', 'd1')).toEqual([]);
    expect(profundidad(a, 't1', 'expenses')).toBe(1);
    expect(profundidad(a, 't1', 'comments')).toBe(1);

    // t2 sigue intacto
    expect(leerCubo(a, 't2', 'd1', 'ck3')).toEqual({ digest: 'v', publicadaEn: 1 });
    expect(profundidad(a, 't2', 'expenses')).toBe(2);
  });

  it('dato corrupto en el índice se trata como ausente, no tira', () => {
    const a = memoria();
    a.set('sliceLedgerIndice\u0000t1', '{esto no es json válido');
    expect(ckeysDelTopic(a, 't1', 'd1')).toEqual([]);
    // y registrar sigue funcionando después de una lectura corrupta
    registrarCubo(a, 't1', 'd1', 'ck1', 'v', 1);
    expect(ckeysDelTopic(a, 't1', 'd1')).toEqual(['ck1']);
  });
});
