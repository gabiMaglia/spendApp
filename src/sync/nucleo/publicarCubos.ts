import type { GroupKey } from './envelopeCrypto';
import { deriveCkey } from './ckey';
import { digestOfJson, MANIFEST_VERSION, type SliceManifest } from './manifest';
import { RENEWAL_WINDOW_MS } from '@/src/sync/adaptadores/hushsplit/sliceRenewal';
import { excesoDe } from './topes';
import { cubosDe, jsonDeCubo, profundidadNecesaria, SPLIT_BYTES } from './cubos';
import {
  leerCubo, registrarCubo, olvidarCubo, profundidad, subirProfundidad,
  ckeysDeCampo, guardarCkeysDeCampo,
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
    if (d > dGuardada) subirProfundidad(almacen, topic, campo, d);

    const cubos = await cubosDe(registros, d);
    const prefijos = [...cubos.keys()].sort((a, b) => a.localeCompare(b));
    const ckeysNuevas: string[] = [];

    for (const prefijo of prefijos) {
      const lista = cubos.get(prefijo)!;
      const ckey = await deriveCkey(key, campo, prefijo);
      ckeysNuevas.push(ckey);
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

    // Cubos que YA NO existen para este campo — hallazgo QA #1 / V4 del
    // verifier: antes esto sólo pasaba cuando la profundidad SUBÍA
    // (histéresis, spec §7 C3); a la MISMA profundidad, un cubo que queda
    // vacío porque un miembro se fue (`armar()` ya no lo incluye en `users`)
    // o un gasto se traspasó a otro grupo (filtrado por `groupId`) nunca se
    // vaciaba ni se borraba del ledger — quedaba colgado en el buzón hasta
    // el TTL de 30 días, y un tercero que entrara desde el cursor 0 lo
    // recibía igual (`acotarDeltaAlGrupo` no tiene con qué compararlo si
    // nunca fue local). `ckeysDeCampo` guarda el snapshot de la publicación
    // ANTERIOR; cualquier ckey que estaba ahí y no está en `ckeysNuevas` —ya
    // sea porque el registro se fue (misma profundidad) o porque la
    // profundidad subió (todas las ckeys viejas quedan afuera, distinto
    // largo de prefijo)— se vacía con `[]` y se olvida del ledger.
    //
    // V5 (verifier, hallazgo menor): esto va DESPUÉS de los cubos nuevos, no
    // antes — si la red se corta acá, un recién llegado ya vio los cubos
    // nuevos de este campo, y el manifiesto (que se arma con `ckeysNuevas`
    // más abajo) declara el hueco real en vez de no declarar nada.
    const ckeysViejas = ckeysDeCampo(almacen, topic, campo);
    for (const ckeyVieja of ckeysViejas) {
      if (ckeysNuevas.includes(ckeyVieja)) continue;
      const r = await enviarConCesion(ckeyVieja, JSON.stringify(envolver(campo, [])));
      if (!r.ok) return r;
      olvidarCubo(almacen, topic, deviceId, ckeyVieja);
    }
    guardarCkeysDeCampo(almacen, topic, campo, ckeysNuevas);
  }

  const manifiesto: SliceManifest = { version: MANIFEST_VERSION, entries: manifiestoEntradas };
  const manifiestoCkey = await deriveCkey(key, 'manifest', 'unica');
  const r = await enviarConCesion(manifiestoCkey, JSON.stringify(manifiesto));
  if (!r.ok) return r;
  return { ok: true, seq: r.seq };
}
