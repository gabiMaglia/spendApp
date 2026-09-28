/**
 * T-191, Task 2 (spec §2.2, §7/§8 C3-C5) — publicar sólo lo que cambió.
 *
 * P6, P7, P8, P9 y P20 ejercitan el núcleo (`relay/publicarCubos.ts`)
 * directo, con un `AlmacenPort` en memoria y un `enviar` falso que cuenta
 * sobres — mismo patrón que `sliceLedger.test.ts` y `cubos.test.ts` (Tasks 0
 * y 1): no hace falta la app entera para probar "¿cuántos sobres salieron y
 * con qué contenido?".
 *
 * P23 (el reingreso/purga olvidan el ledger) SÍ necesita la integración real
 * — `publishToGroup`/`deleteMyGroupEnvelopes`/`marcarPendienteDeDrenaje` con
 * los stores de HushSplit — porque es ahí donde vive el wiring que se está
 * verificando, no en el núcleo.
 */
import { publicarPorCubos, type CampoDoc, type EnviarPieza } from '../relay/publicarCubos';
import { leerCubo, profundidad, type AlmacenPort } from '../relay/sliceLedger';
import { generateGroupKey } from '../envelopeCrypto';
import { RENEWAL_WINDOW_MS } from '../sliceRenewal';

function memoria(): AlmacenPort {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k),
    set: (k, v) => { m.set(k, v); },
    delete: (k) => { m.delete(k); },
  };
}

function envolver(campo: string, registros: { id: string }[]): unknown {
  return { campo, registros };
}

/** `enviar` falso: siempre confirma, cuenta llamados y guarda ckey+json. */
function enviarFalso() {
  const piezas: { ckey: string; json: string }[] = [];
  let seq = 0;
  const enviar: EnviarPieza = async (ckey, json) => {
    piezas.push({ ckey, json });
    return { ok: true, seq: ++seq };
  };
  return { enviar, piezas: () => piezas };
}

const NO_CEDER = async () => {};

describe('publicarPorCubos — publicar sólo lo que cambió (T-191 Task 2)', () => {
  it('P9: ledger vacío (reinstalación) — se publica todo', async () => {
    const key = generateGroupKey();
    const almacen = memoria();
    const campos: CampoDoc[] = [
      { campo: 'groups', registros: [{ id: 'g1' }] },
      { campo: 'expenses', registros: [{ id: 'e1' }, { id: 'e2' }] },
    ];
    const { enviar, piezas } = enviarFalso();

    const r = await publicarPorCubos(campos, envolver, key, almacen, 'topic1', 'device1', 1_000, enviar, NO_CEDER);

    expect(r.ok).toBe(true);
    // groups: 1 cubo, expenses: 1 cubo (2 registros chicos entran juntos), + manifiesto.
    expect(piezas().length).toBe(3);
  });

  it('P6: segunda publicación sin cambios — sólo el manifiesto (1 sobre)', async () => {
    const key = generateGroupKey();
    const almacen = memoria();
    const campos: CampoDoc[] = [
      { campo: 'groups', registros: [{ id: 'g1' }] },
      { campo: 'expenses', registros: [{ id: 'e1' }] },
    ];

    const primera = enviarFalso();
    await publicarPorCubos(campos, envolver, key, almacen, 'topic1', 'device1', 1_000, primera.enviar, NO_CEDER);
    expect(primera.piezas().length).toBe(3); // groups + expenses + manifiesto

    const segunda = enviarFalso();
    const r = await publicarPorCubos(campos, envolver, key, almacen, 'topic1', 'device1', 2_000, segunda.enviar, NO_CEDER);

    expect(r.ok).toBe(true);
    expect(segunda.piezas().length).toBe(1); // sólo el manifiesto
  });

  it('P7: edición de un gasto — 2 sobres (el cubo de expenses + el manifiesto)', async () => {
    const key = generateGroupKey();
    const almacen = memoria();
    const gastoV1: CampoDoc[] = [
      { campo: 'groups', registros: [{ id: 'g1' }] },
      { campo: 'expenses', registros: [{ id: 'e1', monto: 10 } as never] },
    ];
    await publicarPorCubos(gastoV1, envolver, key, almacen, 'topic1', 'device1', 1_000, enviarFalso().enviar, NO_CEDER);

    const gastoV2: CampoDoc[] = [
      { campo: 'groups', registros: [{ id: 'g1' }] }, // sin cambios
      { campo: 'expenses', registros: [{ id: 'e1', monto: 20 } as never] }, // editado
    ];
    const segunda = enviarFalso();
    const r = await publicarPorCubos(gastoV2, envolver, key, almacen, 'topic1', 'device1', 2_000, segunda.enviar, NO_CEDER);

    expect(r.ok).toBe(true);
    expect(segunda.piezas().length).toBe(2); // cubo de expenses (cambió) + manifiesto
  });

  it('P8: cubo sin cambios pero con publicadaEn vencida (>20 días) — se reenvía', async () => {
    const key = generateGroupKey();
    const almacen = memoria();
    const campos: CampoDoc[] = [{ campo: 'expenses', registros: [{ id: 'e1' }] }];

    const t0 = 1_000_000;
    await publicarPorCubos(campos, envolver, key, almacen, 'topic1', 'device1', t0, enviarFalso().enviar, NO_CEDER);

    // Dentro de la ventana: no se reenvía (control, mismo criterio que P6).
    const dentroDeVentana = enviarFalso();
    await publicarPorCubos(campos, envolver, key, almacen, 'topic1', 'device1', t0 + 1_000, dentroDeVentana.enviar, NO_CEDER);
    expect(dentroDeVentana.piezas().length).toBe(1); // sólo manifiesto

    // Vencida: se reenvía el cubo aunque el contenido sea idéntico.
    const vencida = enviarFalso();
    const ahora = t0 + RENEWAL_WINDOW_MS + 1;
    const r = await publicarPorCubos(campos, envolver, key, almacen, 'topic1', 'device1', ahora, vencida.enviar, NO_CEDER);

    expect(r.ok).toBe(true);
    expect(vencida.piezas().length).toBe(2); // cubo renovado + manifiesto
  });

  it('P20: la profundidad sube 1→2 y NUNCA baja — se publica [] en la ckey vieja y los cubos nuevos', async () => {
    const key = generateGroupKey();
    const almacen = memoria();
    const SPLIT = 3_000;
    const relleno = 'x'.repeat(2_000);
    // Mismo prefijo de 1 hex ('0') a d=1; prefijos DISTINTOS a d=2 ('00' vs '01').
    const registroA = { id: '00000000-0000-4000-8000-000000000001', relleno };
    const registroB = { id: '01000000-0000-4000-8000-000000000002', relleno };

    // Fase 1: sólo A. Un solo registro entra bajo SPLIT a d=1 — no hay bump.
    const fase1 = enviarFalso();
    await publicarPorCubos(
      [{ campo: 'expenses', registros: [registroA] }],
      envolver, key, almacen, 'topic1', 'device1', 1_000, fase1.enviar, NO_CEDER,
      undefined, SPLIT,
    );
    expect(fase1.piezas().length).toBe(2); // 1 cubo (prefijo '0') + manifiesto
    expect(profundidad(almacen, 'topic1', 'expenses')).toBe(1);

    // Fase 2: se agrega B. A+B juntos en el cubo '0' a d=1 superan SPLIT —
    // sube a d=2, donde A y B caen en cubos distintos ('00' y '01').
    const fase2 = enviarFalso();
    const r = await publicarPorCubos(
      [{ campo: 'expenses', registros: [registroA, registroB] }],
      envolver, key, almacen, 'topic1', 'device1', 2_000, fase2.enviar, NO_CEDER,
      undefined, SPLIT,
    );
    expect(r.ok).toBe(true);
    // 1 ckey vieja vaciada (prefijo '0' a d=1, la única que el ledger tenía
    // registrada) + 2 cubos nuevos (prefijos '00' y '01') + manifiesto.
    expect(fase2.piezas().length).toBe(4);
    expect(profundidad(almacen, 'topic1', 'expenses')).toBe(2);

    const ckeyVieja = fase2.piezas().find(p => JSON.parse(p.json).registros?.length === 0);
    expect(ckeyVieja).toBeDefined();
    expect(leerCubo(almacen, 'topic1', 'device1', ckeyVieja!.ckey)).toBeNull(); // se olvidó del ledger

    // Fase 3: el registro B se va (el grupo vuelve a ser chico). La
    // profundidad NO baja, aunque a d=1 ya entraría bajo SPLIT de sobra.
    const fase3 = enviarFalso();
    await publicarPorCubos(
      [{ campo: 'expenses', registros: [registroA] }],
      envolver, key, almacen, 'topic1', 'device1', 3_000, fase3.enviar, NO_CEDER,
      undefined, SPLIT,
    );
    expect(profundidad(almacen, 'topic1', 'expenses')).toBe(2); // histéresis: no baja
  });
});
