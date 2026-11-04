/**
 * T-267 · B renueva cubos que contienen registros de A: cuando A desaparece y
 * sus sobres vencen, B republica el ESTADO completo (el armado no distingue
 * autores), así que nada de lo de A se pierde.
 */
import { publicarPorCubos, type CampoDoc, type EnviarPieza } from '../publicarCubos';
import { generateGroupKey } from '../envelopeCrypto';
import { publicadoMasViejoEn, type AlmacenPort } from '../sliceLedger';
import { RENEWAL_WINDOW_MS } from '../limites';

function memoria(): AlmacenPort {
  const m = new Map<string, string>();
  return { get: k => m.get(k), set: (k, v) => { m.set(k, v); }, delete: k => { m.delete(k); } };
}
const DIA = 24 * 60 * 60 * 1000;
const envolver = (campo: string, registros: { id: string }[]) => ({ campo, registros });

it('B renueva, sin cambios locales, cubos con los ids de A y renueva el cubo más viejo', async () => {
  const key = generateGroupKey();
  const almacen = memoria();
  const campos: CampoDoc[] = [
    { campo: 'expenses', registros: [{ id: 'aaa1' }, { id: 'aaa2' }, { id: 'bbb1' }] }, // aaa* = de A
  ];
  const enviados: string[] = [];
  const enviar: EnviarPieza = async (_ck, json) => { enviados.push(json); return { ok: true, seq: enviados.length }; };
  const nada = async () => {};

  await publicarPorCubos(campos, envolver, key, almacen, 't', 'devB', 0, enviar, nada);
  enviados.length = 0;

  const dia21 = RENEWAL_WINDOW_MS + DIA;
  await publicarPorCubos(campos, envolver, key, almacen, 't', 'devB', dia21, enviar, nada);

  const todo = enviados.join('');
  for (const id of ['aaa1', 'aaa2', 'bbb1']) expect(todo).toContain(id);
  expect(publicadoMasViejoEn(almacen, 't', 'devB')).toBe(dia21);
});
