import { syncableGroupIds } from './publish';

/**
 * Drenaje con debounce y `drainAll` (T-189: extraído de `relayEngine.ts`).
 *
 * `drainNow` en sí (bajar y aplicar UN grupo) se queda en la fachada a
 * propósito: `syncNotices.test.ts` («está enchufado al sync») lee el TEXTO
 * de `relayEngine.ts` y exige, con `export async function drainNow` ahí
 * mismo, que `drainGroup(` envuelva a `antesDeAplicar:` y éste a `snapshot(`
 * — es una guarda contra reintroducir la foto ANTES de la bajada (T-158b).
 * Ese archivo no distingue "se movió a otro módulo" de "se rompió el
 * enganche", así que el texto tiene que seguir estando ahí.
 *
 * Este módulo sólo sabe CUÁNDO drenar (debounce de avisos realtime, y el
 * barrido de `drainAll`) — no CÓMO. Recibe el `drainNow` real por inyección,
 * igual que `startPolling(releer)` en `./poll.ts` recibe la relectura: así
 * no importa el drenaje real "hacia arriba", hacia la fachada.
 */
export type DrainNowImpl = (groupId: string) => Promise<number>;
let ejecutarDrainNow: DrainNowImpl = async () => 0;

/** Sólo la fachada llama a esto, una vez, al cargar el módulo. */
export function setDrainNowImpl(fn: DrainNowImpl): void {
  ejecutarDrainNow = fn;
}

/**
 * Ventana de agrupación para el drenaje disparado por avisos realtime
 * (revisión final, Fix 1 — mismo mecanismo que `PUBLISH_DEBOUNCE_MS`).
 *
 * Con ADR-007 una publicación manda K+1 sobres (K rebanadas + 1 manifiesto) en
 * vez de uno solo, y cada INSERT dispara su propio aviso realtime por
 * separado (`subscribeTopic` no los agrupa). Sin debounce, la ráfaga de K+1
 * avisos de una MISMA publicación disparaba K+1 llamadas a `drainNow`
 * superpuestas: cada una avanzaba el cursor persistido, así que para cuando
 * el aviso del sobre de MANIFIESTO llegaba a disparar SU drenaje, las
 * rebanadas de datos casi siempre ya habían sido aplicadas y consumidas por
 * drenajes anteriores de la misma ráfaga. Ese último drenaje veía, en su
 * propio lote, sólo el manifiesto —cero rebanadas de datos—, y el chequeo de
 * gaps de `drainGroup` reportaba TODAS las ckeys declaradas como "faltantes",
 * aunque hubieran llegado bien (sólo que en un drenaje anterior). El gap
 * además quedaba pegado: sólo se limpia cuando manifiesto y rebanadas caen en
 * el MISMO lote de drenaje, algo que con este bug casi nunca pasaba solo.
 *
 * Agrupar los avisos de una misma ráfaga en un solo `drainNow`, disparado
 * recién cuando la ráfaga se aquieta, hace que ese único drenaje vea
 * manifiesto + todas sus rebanadas juntos — exactamente como
 * `publishToGroup` los mandó — y el chequeo de completitud corre sobre el
 * cuadro completo, no sobre un recorte artificial producido por la
 * superposición de drenajes.
 */
export const DRAIN_DEBOUNCE_MS = 1_500;

/**
 * Candado de "ya hay un drenaje disparado por AVISO en vuelo para este
 * grupo" (Fix 1, hallazgo m6 · "amplificación por drenaje concurrente").
 *
 * A propósito NO envuelve `drainNow` en general — sólo el disparo que sale
 * de `scheduleDrain`. `drainNow` tiene llamadores directos e intencionales
 * que necesitan poder correr aunque YA haya un drenaje del mismo grupo en
 * vuelo: el más importante es `elegirClaveDeGrupo` (T-136 · D-1), que
 * adopta una clave nueva y dispara su propio `drainNow` inmediatamente
 * después — con la clave NUEVA — mientras un drenaje anterior (con la
 * clave VIEJA, en disputa) puede seguir esperando su `fetchSince`. Si ese
 * segundo `drainNow` reutilizara la promesa del primero (como hacía una
 * versión anterior de este arreglo, revertida por romper exactamente este
 * caso — ver `drenajeEnVueloTrasElegir.test.ts`), el drenaje con la clave
 * correcta nunca arrancaría de verdad: quedaría pegado esperando a que
 * termine uno que ya no tiene sentido. Este candado sólo cubre la ráfaga de
 * avisos realtime — que sí son intercambiables entre sí (son sólo "algo
 * cambió, andá a mirar") — nunca una invocación explícita del dominio.
 */
const drenajesPorAvisoEnCurso = new Set<string>();
const pendientesDrain = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Dispara el drenaje agendado por `scheduleDrain`. Si ya hay uno de este
 * MISMO origen (aviso realtime) corriendo para el grupo, no arranca uno
 * nuevo — el aviso que lo hubiera disparado ya no aporta nada que el
 * drenaje en curso no vaya a leer de todos modos en su propio `fetchSince`.
 */
function dispararDrainAgendado(groupId: string): void {
  if (drenajesPorAvisoEnCurso.has(groupId)) return;
  drenajesPorAvisoEnCurso.add(groupId);
  void ejecutarDrainNow(groupId).finally(() => {
    drenajesPorAvisoEnCurso.delete(groupId);
  });
}

/**
 * Agenda un drenaje para el grupo, agrupando ráfagas de avisos realtime.
 * Llamarla muchas veces seguidas para el mismo grupo produce UN solo
 * `drainNow` — mismo patrón que `schedulePublish` para publicaciones.
 */
export function scheduleDrain(groupId: string, delay = DRAIN_DEBOUNCE_MS): void {
  const anterior = pendientesDrain.get(groupId);
  if (anterior) clearTimeout(anterior);

  pendientesDrain.set(groupId, setTimeout(() => {
    pendientesDrain.delete(groupId);
    dispararDrainAgendado(groupId);
  }, delay));
}

/** Sólo para tests: cancela los drenajes agendados pendientes. */
export function cancelPendingDrains(): void {
  for (const t of pendientesDrain.values()) clearTimeout(t);
  pendientesDrain.clear();
}

/** Drena todos los grupos sincronizables. Se llama al abrir la app. */
export async function drainAll(): Promise<number> {
  let total = 0;
  for (const groupId of syncableGroupIds()) total += await ejecutarDrainNow(groupId);
  return total;
}
