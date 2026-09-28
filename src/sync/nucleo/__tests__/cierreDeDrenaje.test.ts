import {
  cursorFinal, completoFinal, clasificarRetenidas, quitarNoResueltas, faltantesSoloRetenidas,
  type Retenida,
} from '../cierreDeDrenaje';

const r = (seq: number, sender: string, ckey?: string): Retenida => ({ seq, sender, ckey });

describe('cierreDeDrenaje (T-192, Task 3 — núcleo puro del cierre de drainGroup)', () => {
  // T1: cursor con H — se recorta a justo antes de la más vieja de las retenidas.
  it('cursorFinal recorta al mínimo(base, minSeqDeH - 1) cuando hay retenidas con cupo', () => {
    const H = [r(50, 'a'), r(40, 'b')];
    expect(cursorFinal(100, H)).toBe(39);
  });

  // T3: cupo agotado sale de H — clasificarRetenidas no la incluye en H aunque siga pendiente.
  it('clasificarRetenidas saca de H la retenida con cupo agotado, aunque siga pendiente', () => {
    const pendienteConCupo = r(10, 'a', 'k1');
    const pendienteSinCupo = r(20, 'b', 'k2');
    const resuelta = r(30, 'c', 'k3');
    const { H, noResueltas } = clasificarRetenidas([
      { retenida: pendienteConCupo, siguePendiente: true, agotada: false },
      { retenida: pendienteSinCupo, siguePendiente: true, agotada: true },
      { retenida: resuelta, siguePendiente: false, agotada: false },
    ]);
    expect(H).toEqual([pendienteConCupo]);
    expect(noResueltas).toEqual([pendienteConCupo, pendienteSinCupo]);
  });

  // T6: sin retenidas, el cursor final es la base (ni cambia ni recorta).
  it('cursorFinal sin H devuelve la base sin tocarla', () => {
    expect(cursorFinal(777, [])).toBe(777);
  });
  it('completoFinal sin H conserva el `completo` original', () => {
    expect(completoFinal(true, [])).toBe(true);
    expect(completoFinal(false, [])).toBe(false);
  });
  it('completoFinal con H siempre da false, aunque completo fuera true', () => {
    expect(completoFinal(true, [r(1, 'a')])).toBe(false);
  });

  // T7: invariante cursor >= sinceSeq cuando base >= sinceSeq (H nunca es anterior a sinceSeq).
  it('cursorFinal nunca baja de sinceSeq cuando la retenida más vieja es posterior', () => {
    const sinceSeq = 100;
    const base = 150; // base >= sinceSeq, por construcción de drainGroup
    const H = [r(120, 'a')]; // la retenida más vieja leída en este drenaje, siempre > sinceSeq
    const cursor = cursorFinal(base, H);
    expect(cursor).toBe(119);
    expect(cursor).toBeGreaterThanOrEqual(sinceSeq);
  });

  it('quitarNoResueltas borra del mapa de recibidas sólo las entradas no resueltas', () => {
    const recibidas = new Map<string, Map<string, string>>([
      ['sender-a', new Map([['k1', 'json1'], ['k2', 'json2']])],
      ['sender-b', new Map([['k3', 'json3']])],
    ]);
    quitarNoResueltas(recibidas, [r(1, 'sender-a', 'k1')]);
    expect(recibidas.get('sender-a')?.has('k1')).toBe(false);
    expect(recibidas.get('sender-a')?.has('k2')).toBe(true);
    expect(recibidas.get('sender-b')?.has('k3')).toBe(true);
  });

  it('quitarNoResueltas ignora retenidas sin ckey (nada que borrar de recibidas)', () => {
    const recibidas = new Map<string, Map<string, string>>([
      ['sender-a', new Map([['k1', 'json1']])],
    ]);
    quitarNoResueltas(recibidas, [r(1, 'sender-a')]);
    expect(recibidas.get('sender-a')?.has('k1')).toBe(true);
  });

  it('faltantesSoloRetenidas: true cuando TODOS los faltantes son retenidas no resueltas', () => {
    const faltantes = [{ ckey: 'k1' }, { ckey: 'k2' }];
    expect(faltantesSoloRetenidas(faltantes, new Set(['k1', 'k2']))).toBe(true);
  });

  it('faltantesSoloRetenidas: false si algún faltante no es una retenida conocida', () => {
    const faltantes = [{ ckey: 'k1' }, { ckey: 'k2' }];
    expect(faltantesSoloRetenidas(faltantes, new Set(['k1']))).toBe(false);
  });

  it('faltantesSoloRetenidas: false con lista de faltantes vacía (no hay "solo retenidas" sin faltantes)', () => {
    expect(faltantesSoloRetenidas([], new Set(['k1']))).toBe(false);
  });
});
