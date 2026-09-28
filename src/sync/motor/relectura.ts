import type { GroupKey } from '@/src/sync/nucleo/envelopeCrypto';
import { fetchSince } from '@/src/sync/adaptadores/supabase/relay';
import { digestOfJson } from '@/src/sync/nucleo/manifest';
import { registrarFalloDeAplicacion } from '@/src/sync/nucleo/drainFailures';
import { abrirSobre } from '@/src/sync/nucleo/abrirSobre';
import * as adaptador from '@/src/sync/adaptadores/hushsplit/adaptadorHushSplit';
import * as appliedSlices from '@/src/sync/nucleo/appliedSlices';
import { aplicarDeltaAcotado } from '@/src/sync/adaptadores/hushsplit/aplicarAcotado';
import { sigueSiendoLaClave } from './claveVigente';

/**
 * Tamaño de página de `fetchSince`. Exportado para que el test lo fije.
 * Antes era la única lectura por drenaje: con K+1 sobres por dispositivo y
 * las huérfanas que dejaba la `ckey` por `seedId`, 200 se alcanzaba, y la
 * marca de T-089 se limpiaba igual (TEC-02).
 */
export const DRAIN_FETCH_LIMIT = 200;

/**
 * Techo de páginas por drenaje. 25 × 200 = 5.000 sobres; un buzón más grande
 * que eso es o un ataque de relleno (SEC-03, T-147) o un bug, y en los dos
 * casos lo correcto es aplicar lo leído, devolver `completo: false` y seguir
 * en la próxima vuelta en vez de colgar el hilo.
 */
export const DRAIN_MAX_PAGES = 25;

/**
 * Relectura acotada (T-191, Task 3, spec §7/§8 C6): el manifiesto de `sender`
 * declaró una `ckey` que este drenaje no pudo dar por cumplida (no llegó hoy
 * y no estaba en `appliedSlices`). Se relee el topic desde el cursor 0 —el
 * buzón conserva la última versión de cada cubo por emisor (compactación por
 * `(topic, owner, ckey)`), así que un cubo viejo vuelve a estar ahí— y se
 * aplica cualquier pieza de `sender` cuya `ckey` siga faltando. El llamador
 * ya verificó con `relecturas.permite` que esto corre A LO SUMO una vez por
 * `(topic, sender, seq del manifiesto)`.
 *
 * Devuelve las `ckey` que SIGUEN faltando después de este intento — pueden
 * quedar si la relectura no encontró el sobre (se perdió de verdad), si
 * seguía teniendo descartes por dependencia, o si la red falló a mitad de
 * camino.
 */
export async function releerFaltantes(
  groupId: string,
  currentUserId: string,
  deviceId: string,
  topic: string,
  key: GroupKey,
  record: { key: string; epoch: number },
  sender: string,
  faltantes: { ckey: string; digest: string }[],
): Promise<string[]> {
  const declarados = new Map(faltantes.map(f => [f.ckey, f.digest]));
  const pendientes = new Set(faltantes.map(f => f.ckey));
  let cursor = 0;

  for (let pagina = 0; pagina < DRAIN_MAX_PAGES && pendientes.size > 0; pagina++) {
    const r = await fetchSince(topic, cursor, deviceId, DRAIN_FETCH_LIMIT);
    if (!r.ok) break; // sin red: queda faltante, se reintenta con el próximo manifiesto
    if (!sigueSiendoLaClave(groupId, record)) break;

    for (const envelope of r.envelopes) {
      if (envelope.sender !== sender || !envelope.ckey || !pendientes.has(envelope.ckey)) continue;

      // T-206-A (D10): antes esto verificaba firma/cifrado/parseo/clasificación
      // a mano, duplicando lo que `abrirSobre` (`nucleo/abrirSobre.ts`) ya hace
      // para el drenaje normal (`drenar.ts`). Migrar acá trae un rastro nuevo
      // que la versión manual no tenía: `abrirSobre` cuenta
      // `manifest_malformado` (`registrarFalloDeAplicacion`) cuando algo
      // LOOKS LIKE un manifiesto pero no pasa la validación completa —
      // antes esta relectura lo descartaba en silencio, igual que si fuera
      // una rebanada de datos cualquiera.
      const abierto = abrirSobre(envelope, key, topic);
      if (abierto.tipo !== 'rebanada') continue; // descartado, o esta ckey es de un manifiesto

      // Fix 4 (heredado de T-146): el contenido tiene que coincidir con el
      // digest que el manifiesto declaró para esta ckey — un sobre corrupto
      // o una versión equivocada bajo la misma ckey NUNCA se acepta como
      // "encontrado" sólo porque decodificó. Si no coincide, sigue faltante.
      const digest = await digestOfJson(abierto.json);
      if (digest !== declarados.get(envelope.ckey)) continue;

      try {
        const descartes = await aplicarDeltaAcotado(groupId, currentUserId, abierto.delta);
        if (descartes.porDependencia === 0) {
          appliedSlices.registrar(adaptador.almacen, topic, sender, envelope.ckey, {
            digest, seq: envelope.seq, senderKey: abierto.senderKey,
          });
          pendientes.delete(envelope.ckey);
        }
      } catch (e) {
        registrarFalloDeAplicacion(topic, envelope.seq, e);
      }
    }

    cursor = r.cursor;
    const hayMas = r.more ?? r.envelopes.length >= DRAIN_FETCH_LIMIT;
    if (!hayMas) break;
  }

  return [...pendientes];
}
