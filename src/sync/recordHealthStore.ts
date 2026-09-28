import type { CoreVerdict } from './recordSign';
import type { RatchetPos } from './ratchet';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from '@/src/store/userScope';

/**
 * Estado y persistencia de la medición de S6 (T-041) — salió de
 * `recordHealth.ts` (T-192) para que ese archivo quede bajo 400 líneas.
 * `recordHealth.ts` (observación) y `recordHealth.ts` (reporte) son los dos
 * lados que leen/escriben este estado; acá vive el storage y los
 * mutadores — nunca la decisión de qué contar (eso sigue en `observeRecord`).
 */

export type RecordVerdict = CoreVerdict | 'no_firmable';

/** Lo que salió del descarte barato antes de mirar nada. */
export type ObserveOutcome = RecordVerdict | 'omitido';

export type RecordStats = Record<RecordVerdict, number>;

/**
 * Lo que este device ya tiene de ese registro. `undefined` = no lo tenemos, y
 * entonces cualquier revisión es nueva.
 */
export type LocalCore = { rev: number } | undefined;

/** Un `invalida` agrupado. Contador, no N filas iguales (`authorHealth.ts:38-45`). */
export type RecordObservation = {
  groupId: string;
  authorId: string;
  at: number;
  count: number;
};

const storage = createSecureStorage('users');

export const RECORD_HEALTH_KEY = 'record_health_v1';

/** Techo del detalle. Lo que sobra no se pierde: sigue contado en `invalida`. */
export const RECORD_DETAIL_MAX = 20;

const VEREDICTOS: readonly RecordVerdict[] = ['valida', 'invalida', 'no_verificable', 'no_firmable'];

let conteo: RecordStats = { valida: 0, invalida: 0, no_verificable: 0, no_firmable: 0 };

/**
 * Los `no_verificable`, partidos por la posición del trinquete de su autor.
 * Es lo único que aporta el trinquete ahora que no se rechaza nada: "sin
 * firma, y su autor nunca firmó" es el histórico (R2, opción A), mientras
 * que "sin firma, y su autor firma el resto" es la fila que hay que mirar.
 */
let sinFirmaPorTrinquete: Record<RatchetPos, number> = { desconocido: 0, firma: 0 };

let costo = { ops: 0, ms: 0 };
/** Registros vistos que ya teníamos: la prueba de que SÍ llegó tráfico. */
let omitidos = 0;

let detalle = new Map<string, RecordObservation>();

let cargado = false;

export function cargar(): void {
  if (cargado) return;
  cargado = true;

  const raw = readScoped(storage, RECORD_HEALTH_KEY);
  if (!raw) return;

  try {
    const d = JSON.parse(raw) as {
      c?: Partial<RecordStats>;
      nv?: Partial<Record<RatchetPos, number>>;
      costo?: { ops?: number; ms?: number };
      om?: number;
      d?: RecordObservation[];
    };
    for (const v of VEREDICTOS) {
      if (typeof d.c?.[v] === 'number') conteo[v] = d.c[v]!;
    }
    for (const p of ['desconocido', 'firma'] as RatchetPos[]) {
      if (typeof d.nv?.[p] === 'number') sinFirmaPorTrinquete[p] = d.nv[p]!;
    }
    if (typeof d.costo?.ops === 'number') costo.ops = d.costo.ops;
    if (typeof d.costo?.ms === 'number') costo.ms = d.costo.ms;
    if (typeof d.om === 'number') omitidos = d.om;
    for (const o of d.d ?? []) {
      if (o && typeof o.authorId === 'string') detalle.set(claveDetalle(o.groupId, o.authorId), o);
    }
  } catch {
    // Dato corrupto: se arranca de cero. Perder la medición es molesto; romper
    // el sync por un JSON mal escrito sería mucho peor, y acá arriba hay un
    // merge que tiene que correr igual (R1).
    conteo = { valida: 0, invalida: 0, no_verificable: 0, no_firmable: 0 };
    sinFirmaPorTrinquete = { desconocido: 0, firma: 0 };
    costo = { ops: 0, ms: 0 };
    omitidos = 0;
    detalle = new Map();
  }
}

function guardar(): void {
  writeScoped(storage, RECORD_HEALTH_KEY, JSON.stringify({
    c: conteo,
    nv: sinFirmaPorTrinquete,
    costo,
    om: omitidos,
    d: [...detalle.values()],
  }));
}

function claveDetalle(groupId: string, authorId: string): string {
  return `${groupId}::${authorId}`;
}

function anotarDetalle(groupId: string, authorId: string): void {
  const clave = claveDetalle(groupId, authorId);
  const previa = detalle.get(clave);
  if (previa === undefined && detalle.size >= RECORD_DETAIL_MAX) return;
  detalle.set(clave, {
    groupId, authorId, at: Date.now(), count: (previa?.count ?? 0) + 1,
  });
}

/** Cuenta un veredicto ya resuelto y persiste. */
export function contar(
  verdict: RecordVerdict, groupId: string, authorId: string, trinquete: RatchetPos,
): void {
  conteo[verdict]++;
  if (verdict === 'no_verificable') sinFirmaPorTrinquete[trinquete]++;
  if (verdict === 'invalida') anotarDetalle(groupId, authorId);
  guardar();
}

/** Descarte barato por `rev`: llegó, ya lo teníamos, ni se verifica ni se cuenta como veredicto. */
export function registrarOmitido(): void {
  omitidos++;
  guardar();
}

/** Registro sin firma cuyo id es derivado: nadie puede firmarlo por diseño. */
export function registrarNoFirmable(): void {
  conteo.no_firmable++;
  guardar();
}

/** Acumula el costo real de UNA verificación pagada (caché no cuenta). */
export function sumarCostoVerificacion(ms: number): void {
  costo.ops++;
  costo.ms += ms;
}

export function getConteo(): RecordStats {
  return { ...conteo };
}

export function getSinFirmaPorTrinquete(): Record<RatchetPos, number> {
  return { ...sinFirmaPorTrinquete };
}

export function getCosto(): { ops: number; ms: number } {
  return { ...costo };
}

export function getOmitidos(): number {
  return omitidos;
}

export function getDetalle(): RecordObservation[] {
  return [...detalle.values()];
}

/** Vacía memoria y disco. Logout, wipe, tests. */
export function clearRecordHealth(): void {
  conteo = { valida: 0, invalida: 0, no_verificable: 0, no_firmable: 0 };
  sinFirmaPorTrinquete = { desconocido: 0, firma: 0 };
  costo = { ops: 0, ms: 0 };
  omitidos = 0;
  detalle = new Map();
  cargado = true;
  writeScoped(storage, RECORD_HEALTH_KEY, '');
}

/** Suelta lo que hay en memoria y vuelve a leer de disco. Cambio de cuenta y tests. */
export function reloadRecordHealth(): void {
  conteo = { valida: 0, invalida: 0, no_verificable: 0, no_firmable: 0 };
  sinFirmaPorTrinquete = { desconocido: 0, firma: 0 };
  costo = { ops: 0, ms: 0 };
  omitidos = 0;
  detalle = new Map();
  cargado = false;
}
