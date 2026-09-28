import type { GroupKey } from '../envelopeCrypto';
import { deriveCkey } from '../slices';
import { digestOfJson, MANIFEST_VERSION, type SliceManifest } from '../manifest';
import { RENEWAL_WINDOW_MS } from '../sliceRenewal';
import { excesoDe } from '../topes';
import { cubosDe, jsonDeCubo, profundidadNecesaria, SPLIT_BYTES } from './cubos';
import {
  leerCubo, registrarCubo, olvidarCubo, profundidad, subirProfundidad,
  type AlmacenPort,
} from './sliceLedger';

/**
 * Publicación incremental por cubos (T-191, Task 2, spec §2.2 y §8 C3-C5) —
 * núcleo puro (guard P15, `relayFrontera.guard.test.ts`): no importa stores
 * ni tipos de modelos de HushSplit. `relaySync.ts` es el único llamador — arma `key`,
 * `almacen` (`adaptador.almacen`) y el callback `enviar` (sella + firma +
 * `sendEnvelope`), y pasa el `Documento` ya armado.
 *
 * Reemplaza el loop viejo de `buildSlicedEnvelopes`/`publishToGroup`: en vez
 * de cortar por ÍNDICE y reenviar TODO siempre, corta por cubo estable
 * (`cubos.ts`) y sólo manda un cubo si cambió su digest o venció la ventana
 * de renovación (`RENEWAL_WINDOW_MS`, reusado de `sliceRenewal.ts` — ese
 * módulo sigue existiendo para las fotos, spec §8 respuesta (4); acá sólo se
 * reusa la constante, no el storage). El manifiesto se manda SIEMPRE, al
 * final, con el digest de TODOS los cubos presentes (se hayan mandado en
 * esta vuelta o no).
 */

export type EnviarPieza = (ckey: string, json: string) => Promise<
  { ok: true; seq: number } | { ok: false; reason: string; detail?: string }
>;

export type CampoDoc = { campo: string; registros: { id: string }[] };

function todosLosPrefijos(d: number): string[] {
  if (d <= 0) return [''];
  const hex = '0123456789abcdef';
  let out = [''];
  for (let i = 0; i < d; i++) {
    const next: string[] = [];
    for (const p of out) for (const c of hex) next.push(p + c);
    out = next;
  }
  return out;
}

export async function publicarPorCubos(
  campos: CampoDoc[],
  envolver: (campo: string, registros: { id: string }[]) => unknown,
  key: GroupKey,
  almacen: AlmacenPort,
  topic: string,
  deviceId: string,
  ahora: number,
  enviar: EnviarPieza,
  ceder: () => Promise<void>,
  onExcluidos?: (campo: string, excluidos: { id: string }[]) => void,
  splitBytes: number = SPLIT_BYTES,
): Promise<{ ok: true; seq: number } | { ok: false; reason: string; detail?: string }> {
  const manifiestoEntradas: { ckey: string; digest: string }[] = [];
  let huboEnvio = false;
  const enviarConCesion: EnviarPieza = async (ckey, json) => {
    // Cede el hilo ENTRE piezas, nunca antes de la primera (T-157b): mismo
    // criterio que el loop viejo de `publishToGroup`.
    if (huboEnvio) await ceder();
    huboEnvio = true;
    return enviar(ckey, json);
  };

  for (const { campo, registros: crudos } of campos) {
    // Un registro individual que supera el tope se excluye ANTES de cubar
    // (T-150, SEC-07): mismo predicado que usaba `sliceEntities`, sólo
    // reubicado — un registro así, dentro de un cubo, haría que
    // `sendEnvelope` rechace el cubo entero para todos los peers honestos.
    const excluidos = crudos.filter(r => excesoDe(r) !== null);
    const registros = excluidos.length > 0 ? crudos.filter(r => excesoDe(r) === null) : crudos;
    if (excluidos.length > 0) onExcluidos?.(campo, excluidos);

    const dGuardada = profundidad(almacen, topic, campo);
    const d = await profundidadNecesaria(registros, dGuardada, splitBytes);

    if (d > dGuardada) {
      // Histéresis (spec §7 C3): la profundidad subió. Los cubos de la
      // profundidad VIEJA que este dispositivo publicó quedan huérfanos en
      // el buzón hasta el TTL si no se avisa — se publica `[]` en cada ckey
      // vieja que el ledger recuerda, para que la compactación del servidor
      // los borre YA, en vez de esperar 30 días.
      for (const prefijoViejo of todosLosPrefijos(dGuardada)) {
        const ckeyVieja = await deriveCkey(key, campo, prefijoViejo);
        if (!leerCubo(almacen, topic, deviceId, ckeyVieja)) continue; // nunca se publicó: nada que vaciar
        const r = await enviarConCesion(ckeyVieja, JSON.stringify(envolver(campo, [])));
        if (!r.ok) return r;
        olvidarCubo(almacen, topic, deviceId, ckeyVieja);
      }
      subirProfundidad(almacen, topic, campo, d);
    }

    const cubos = await cubosDe(registros, d);
    const prefijos = [...cubos.keys()].sort((a, b) => a.localeCompare(b));
    for (const prefijo of prefijos) {
      const lista = cubos.get(prefijo)!;
      const ckey = await deriveCkey(key, campo, prefijo);
      const json = jsonDeCubo(envolver, campo, lista);
      const digest = await digestOfJson(json);
      manifiestoEntradas.push({ ckey, digest });

      const entradaLedger = leerCubo(almacen, topic, deviceId, ckey);
      const cambio = !entradaLedger || entradaLedger.digest !== digest;
      const vencido = !!entradaLedger && (ahora - entradaLedger.publicadaEn > RENEWAL_WINDOW_MS);
      if (!cambio && !vencido) continue;

      const r = await enviarConCesion(ckey, json);
      if (!r.ok) return r;
      registrarCubo(almacen, topic, deviceId, ckey, digest, ahora);
    }
  }

  const manifiesto: SliceManifest = { version: MANIFEST_VERSION, entries: manifiestoEntradas };
  const manifiestoCkey = await deriveCkey(key, 'manifest', 'unica');
  const r = await enviarConCesion(manifiestoCkey, JSON.stringify(manifiesto));
  if (!r.ok) return r;
  return { ok: true, seq: r.seq };
}
