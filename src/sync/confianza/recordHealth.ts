import { ed25519 } from '@noble/curves/ed25519.js';
import type { CoreKind, CoreRecord } from './recordCore';
import { signCore, verifyCore } from './recordSign';
import { verifiedCore, cachedVerdict } from './verdictCache';
import { authorKeysFor, authorKeyWasAsked } from './authorKeys';
import { authorOf } from './signOnWrite';
import { derivedOriginOf } from './derivedRecords';
import { authorRatchet, markAuthorSigns, type RatchetPos } from './ratchet';
import { toHex } from '@/src/sync/nucleo/hexBytes';
import {
  cargar, contar, registrarOmitido, registrarNoFirmable, sumarCostoVerificacion,
  getConteo, getSinFirmaPorTrinquete, getCosto, getOmitidos, getDetalle,
  type RecordVerdict, type ObserveOutcome, type LocalCore, type RecordStats, type RecordObservation,
} from './recordHealthStore';

/**
 * **La medición de S6** (T-041).
 *
 * Acá se verifica, se cuenta, y **no cambia el comportamiento de nada**. Es la
 * decisión R1 del PO, textual: *«prevenir no es la defensa; ver y poder
 * deshacer, sí»*. Un registro que no verifica se muestra, suma al balance y
 * queda marcado. Nunca se esconde, nunca se descarta, nunca se bloquea. Si
 * algún día alguien hace que esta función decida si un registro entra, rompió el
 * ticket entero.
 *
 * Sin fase de rechazo, esta medición **deja de ser el gatillo de un encendido y
 * pasa a ser el producto**: es lo que le dice al PO cuánta suplantación hay y
 * cuánta ceguera.
 *
 * ### Cuatro números, no tres (D4)
 *
 * | Contador | Qué significa |
 * |---|---|
 * | `valida` | firma presente, verifica, y la pública resuelve al autor declarado. **Es el denominador**: sin `valida > 0` los otros no significan nada |
 * | `invalida` | hay firma y no cierra. **Es la señal** |
 * | `no_verificable` | no se puede saber. **No es una sospecha, es falta de información** |
 * | `no_firmable` | nadie puede firmarlo por diseño (`derivedRecords.ts`). Categoría propia por decisión del PO: apartarlos sin contarlos los haría desaparecer |
 *
 * El criterio de cierre de la fase de rechazo («`invalida` sostenido en 0 con
 * `valida` > 0») se evalúa sobre los **tres primeros**, sin el piso permanente
 * que arrastraría el cuarto.
 *
 * ### Qué se cuenta, y qué no
 *
 * Se cuenta **una vez por revisión de núcleo**, no una vez por recepción. El
 * sobre lleva el estado COMPLETO del grupo y se drena cada 20 s por cada miembro
 * que publicó: contar por recepción daría los mismos registros multiplicados por
 * el tráfico, que es la versión numérica del error que `authorHealth.ts:38-45`
 * ya evitó con un contador en vez de N filas iguales. Un núcleo cuyo `rev` no
 * supera al que ya tenemos no puede cambiar nada y se descarta antes de tocar
 * la criptografía — es la mitigación 2 del §C.9, y va **primero**.
 *
 * ### El error que este proyecto ya pagó
 *
 * `authorHealth.ts:55-65`, en el código: *«`unverifiedAuthors()` sola MIENTE por
 * omisión: da cero tanto si todo verificó como si no se pudo consultar nada, que
 * son conclusiones opuestas»*. Por eso los cuatro se reportan siempre juntos, y
 * por eso la medición se **persiste y se scopea por cuenta**: una que se resetea
 * en cada arranque vive siempre cerca de cero, que es la lectura equivocada.
 *
 * Estado y storage viven en `recordHealthStore.ts` (T-192): acá sólo la
 * decisión de qué contar (`observeRecord`) y el reporte hacia afuera.
 */

export {
  RECORD_HEALTH_KEY, RECORD_DETAIL_MAX, clearRecordHealth, reloadRecordHealth,
  type RecordVerdict, type ObserveOutcome, type RecordStats, type LocalCore, type RecordObservation,
} from './recordHealthStore';

/**
 * Reloj de resolución alta cuando lo hay.
 *
 * En Hermes `performance.now()` existe, pero no se da por sentado: sin él,
 * `Date.now()` alcanza porque lo que se lee es el acumulado de muchas
 * operaciones, no una sola.
 */
function ahora(): number {
  const p = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof p?.now === 'function' ? p.now() : Date.now();
}

function textoDe(record: unknown, campo: string): string {
  const v = (record as Record<string, unknown>)[campo];
  return typeof v === 'string' ? v : '';
}

/**
 * El veredicto de un registro entrante, contado.
 *
 * **Nunca decide si el registro se aplica** — el llamador ya lo va a mergear
 * igual. Devuelve el veredicto para que los tests y el diagnóstico lo lean.
 *
 * Síncrona y sin red: la llama `applyDelta`, que es síncrono (§3 del plan). Lo
 * que no se puede resolver localmente se **encola** para consultarlo fuera de
 * banda al drenar, y mientras tanto el veredicto es `no_verificable`.
 */
export function observeRecord<K extends CoreKind>(
  kind: K, record: CoreRecord[K], local?: LocalCore,
): ObserveOutcome {
  cargar();

  /**
   * **Paso 1 — descarte barato por `rev`, antes de todo lo demás** (§C.9).
   *
   * Si el núcleo entrante no supera al que ya tenemos, no puede cambiar nada:
   * ni vale la curva, ni vale contarlo otra vez. En régimen estacionario —donde
   * casi todo lo que llega ya lo tenemos— esto solo se lleva la mayor parte del
   * costo del ticket.
   */
  if (local !== undefined && (record.rev ?? 0) <= local.rev) {
    // Se cuenta aunque no se verifique. Sin este número, los cuatro veredictos
    // en cero significan DOS cosas opuestas —«no llegó ningún sobre» y «llegó y
    // ya lo tenía todo»— y no hay forma de distinguirlas. Es exactamente el
    // error de medición que este proyecto ya documentó: un contador que vale
    // cero por dos razones distintas no es una métrica.
    registrarOmitido();
    return 'omitido';
  }

  const { k, s } = record as { k?: string; s?: string };
  const firmado = Boolean(k && s);

  /**
   * **Paso 2 — los que nadie puede firmar** (D4). Sólo si vienen SIN firma: el
   * id derivado no es una amnistía, y un registro con firma se verifica como
   * cualquier otro aunque su id tenga la forma.
   */
  if (!firmado && derivedOriginOf(kind, record) !== null) {
    registrarNoFirmable();
    return 'no_firmable';
  }

  const groupId = textoDe(record, 'groupId');
  const authorId = authorOf(kind, record) ?? '';
  const trinquete = authorRatchet(authorId);

  // Sin autor declarado no hay nada que atribuir. No es una acusación.
  if (!authorId) {
    contar('no_verificable', groupId, authorId, trinquete);
    return 'no_verificable';
  }

  /**
   * **Paso 3 — sin firma.** Un registro anterior a T-041, o de un peer que no
   * actualizó. Por R2 (opción A) el histórico no se re-firma nunca, así que
   * esto va a pasar para siempre y **no es `invalida`** ni aunque su autor
   * firme todo lo demás: lo que hace el trinquete acá es partir el número, no
   * subirlo de categoría.
   */
  if (!firmado) {
    contar('no_verificable', groupId, authorId, trinquete);
    return 'no_verificable';
  }

  /**
   * `authorKeysFor` y no `resolveAuthorKeys`: la primera es la que **encola la
   * consulta al directorio** cuando la clave presentada no queda cubierta. Con
   * la segunda el disparo fuera de banda no ocurre nunca y las claves nuevas no
   * llegan nunca — que es exactamente el caso de la reinstalación.
   */
  const keys = authorKeysFor(authorId, k);

  // Autor irresoluble: el borde de ADR-004 deja gente legítima sin clave en el
  // directorio, y gastar la curva acá no informaría nada.
  if (keys.length === 0) {
    contar('no_verificable', groupId, authorId, trinquete);
    return 'no_verificable';
  }

  /**
   * **D2 — una clave stale NO puede producir `invalida`.**
   *
   * Quien reinstala queda en nuestro registro local con su clave VIEJA:
   * `keys` no está vacío, tiene una clave, la equivocada. Acusar ahí es acusar a
   * un autor honesto por una limitación nuestra, y —peor— envenena el único
   * número que gobierna si la fase de rechazo se enciende alguna vez. Si cada
   * reinstalación legítima suma `invalida`, el cero del criterio de cierre no
   * llega nunca, y si llegara estaría mintiendo.
   *
   * Sólo hay señal cuando el directorio **ya contestó sobre esta clave** y
   * siguió sin cubrirla. Hasta entonces, `no_verificable`.
   */
  if (!keys.includes(k!)) {
    const veredicto: RecordVerdict = authorKeyWasAsked(authorId, k!) ? 'invalida' : 'no_verificable';
    contar(veredicto, groupId, authorId, trinquete);
    return veredicto;
  }

  /**
   * **Paso 4 — la curva, y sólo acá.** La caché de veredictos (S3) la saltea
   * cuando ya la pagamos por esta firma exacta; el costo se acumula sólo cuando
   * de verdad se pagó, porque el número que el PO necesita leer en su teléfono
   * es el de una verificación, no el promedio diluido por los aciertos de caché.
   */
  const yaEstaba = cachedVerdict(kind, record) !== undefined;
  const t0 = ahora();
  const verdict = verifiedCore(kind, record, keys);
  if (!yaEstaba) sumarCostoVerificacion(ahora() - t0);

  // El trinquete avanza sólo con una firma válida, y no vuelve nunca.
  if (verdict === 'valida') markAuthorSigns(authorId);

  contar(verdict, groupId, authorId, trinquete);
  return verdict;
}

/**
 * Observa una tanda. `localOf` dice qué tenemos ya de cada id — es lo que hace
 * posible el descarte barato sin que este módulo conozca los stores.
 */
export function observeRecords<K extends CoreKind>(
  kind: K, records: readonly CoreRecord[K][], localOf: (id: string) => LocalCore,
): void {
  for (const record of records) {
    observeRecord(kind, record, localOf(textoDe(record, 'id')));
  }
}

/** Los cuatro números. Siempre los cuatro. */
export function recordStats(): RecordStats {
  cargar();
  return getConteo();
}

/**
 * Registros que llegaron y ya teníamos, así que ni se verificaron ni se
 * contaron como veredicto.
 *
 * Es el número que vuelve LEÍBLE a los otros cuatro: con los cuatro en cero,
 * `omitidos > 0` dice «el sync anda, no llegó nada nuevo» y `omitidos === 0`
 * dice «no llegó ni un sobre». Sin esto son indistinguibles.
 */
export function omittedCount(): number {
  cargar();
  return getOmitidos();
}

/** Los `no_verificable`, partidos por posición del trinquete de su autor. */
export function unverifiableBreakdown(): Record<RatchetPos, number> {
  cargar();
  return getSinFirmaPorTrinquete();
}

/** Quiénes acumulan `invalida`. Es lo que alimenta la pantalla de diagnóstico. */
export function invalidRecords(): RecordObservation[] {
  cargar();
  return getDetalle();
}

/**
 * Cuánto costó verificar **de verdad, en este aparato**.
 *
 * Es el gate S6→S7: el §C.9 midió 3,9 ms/op en una laptop Intel de 2019 y se
 * negó —bien— a inventar el multiplicador de Hermes sobre un teléfono. Esto es
 * el número real, medido sobre el tráfico real. `msPorOp` es `null` sin ninguna
 * operación: un promedio sobre cero sería un número inventado.
 */
export function verifyCost(): { ops: number; ms: number; msPorOp: number | null } {
  cargar();
  const costo = getCosto();
  return { ...costo, msPorOp: costo.ops > 0 ? costo.ms / costo.ops : null };
}

/**
 * Banco de pruebas: cuánto tarda **una** verificación en este aparato, ahora.
 *
 * Existe porque `verifyCost()` no dice nada hasta que haya tráfico firmado real,
 * y el gate S6→S7 hace falta antes. No toca la medición ni la caché: firma un
 * núcleo de juguete con una clave fija y verifica N veces contra la curva.
 */
export function benchmarkVerify(iterations = 20): number {
  const priv = toHex(new Uint8Array(32).fill(7));
  const pub = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(7)));

  const base = {
    id: 'bench', groupId: 'bench', amount: 1_234, currency: 'ARS',
    paidById: 'a', splits: [], splitMode: 'equal', category: 'other',
    date: 0, createdAt: 0, createdById: 'a', updatedAt: 0, isDeleted: false, rev: 1,
  };
  const firmado = { ...base, ...signCore('expense', base as never, priv) };

  const t0 = ahora();
  for (let i = 0; i < iterations; i++) verifyCore('expense', firmado as never, [pub]);
  return (ahora() - t0) / Math.max(iterations, 1);
}
