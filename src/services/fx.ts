import { minorFactor, type CurrencyCode } from '@/src/constants/currencies';
import { createStorage } from '@/src/utils/createStorage';

/**
 * Cotizaciones para mostrar totales convertidos (decisión del PO 2026-08-29).
 *
 * FUENTE: `open.er-api.com` (ExchangeRate-API, acceso abierto). Se eligió
 * después de descartar freecurrencyapi contra la API viva: sólo lista 33
 * monedas — las de referencia del BCE — y **6 de las 9 del proyecto quedaban
 * afuera**, incluida ARS, que es la default. Ésta trae 166 y las cubre todas.
 * No lleva API key.
 *
 * LO QUE ESTO **NO** ES: los montos convertidos son un valor DERIVADO, de
 * pantalla. Nunca se escriben en un registro, nunca se usan para saldar una
 * deuda. La plata del modelo sigue siendo entera y en su moneda original
 * (ADR-002); si un monto convertido entrara al modelo, un redondeo distinto en
 * otro dispositivo alcanzaría para descuadrar un balance.
 */

export type FxCache = {
  base:         'USD';
  rates:        Record<string, number>;
  /** Cuándo lo bajamos nosotros. */
  fetchedAt:    number;
  /** Lo que la propia API dice que va a actualizar. 0 = no lo mandó. */
  nextUpdateAt: number;
};

const ENDPOINT = 'https://open.er-api.com/v6/latest/USD';
const KEY = 'rates_v1';
/** Sólo si la API no mandó `time_next_update_unix`. */
const TTL_FALLBACK_MS = 12 * 60 * 60 * 1000;

// Las cotizaciones NO son dato personal: son públicas e iguales para todos.
// Por eso este storage no va scopeado por cuenta — dos cuentas en el mismo
// teléfono comparten la misma tabla y se ahorran una llamada.
const storage = createStorage('fx');

function rateOk(r: unknown): r is number {
  return typeof r === 'number' && Number.isFinite(r) && r > 0;
}

/**
 * ¿Hace falta pedir cotizaciones?
 *
 * Decisión del PO: **si el usuario trabaja en una sola moneda, cero llamadas.**
 * Es el caso mayoritario y no tiene sentido gastar red ni exponer una petición
 * para convertir algo a sí mismo.
 */
export function needsRates(present: CurrencyCode[], display: CurrencyCode): boolean {
  if (present.length === 0) return false;
  const distintas = new Set<string>(present);
  if (distintas.size > 1) return true;
  // Una sola moneda en los datos, pero el usuario quiere verla en otra.
  return !distintas.has(display);
}

/** Se respeta el `nextUpdate` que manda la API; el TTL propio es el respaldo. */
export function isStale(cache: FxCache | null, now: number): boolean {
  if (!cache) return true;
  if (cache.nextUpdateAt > 0) return now >= cache.nextUpdateAt;
  return now - cache.fetchedAt >= TTL_FALLBACK_MS;
}

/**
 * Convierte un entero en menor unidad de una moneda a otra, cruzando por USD.
 *
 * Devuelve `null` —nunca 0— cuando no se puede convertir. Un 0 se sumaría al
 * total como si el gasto no existiera, y el usuario vería un número más chico
 * sin ninguna señal de que le falta plata. `null` obliga a la pantalla a
 * decidir qué decir.
 */
export function convertMinor(
  minor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  cache: FxCache | null,
): number | null {
  // Identidad exacta y antes que nada: convertir ARS→ARS no puede mover un
  // centavo por pasar por un redondeo, ni depender de tener cotizaciones.
  if (from === to) return minor;
  if (!cache) return null;

  const rFrom = cache.rates[from];
  const rTo   = cache.rates[to];
  if (!rateOk(rFrom) || !rateOk(rTo)) return null;

  const enOrigen = minor / minorFactor(from);
  const enUsd    = enOrigen / rFrom;
  const enDestino = enUsd * rTo;
  return Math.round(enDestino * minorFactor(to));
}

/** Lo último que bajamos. `null` si nunca hubo o si quedó corrupto. */
export function readCache(): FxCache | null {
  const raw = storage.getString(KEY);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as FxCache;
    if (!c || typeof c !== 'object' || !c.rates || typeof c.rates !== 'object') return null;
    return c;
  } catch {
    return null; // cache corrupta: se ignora y se vuelve a bajar
  }
}

function writeCache(c: FxCache): void {
  try { storage.set(KEY, JSON.stringify(c)); } catch { /* sin cache se sigue igual */ }
}

/**
 * Baja las cotizaciones y actualiza la cache. **Best effort de punta a punta**:
 * si no hay red, si la API cambia de forma o si devuelve error, se devuelve la
 * cache vieja y la app sigue. Misma premisa que las notificaciones — una
 * cotización que no se pudo bajar es una molestia, una pantalla que se cae por
 * no poder bajarla es un bug.
 */
export async function refreshRates(now: number = Date.now()): Promise<FxCache | null> {
  try {
    const res = await fetch(ENDPOINT);
    if (!res.ok) return readCache();
    const json = await res.json() as {
      result?: string;
      base_code?: string;
      rates?: Record<string, number>;
      time_next_update_unix?: number;
    };
    if (json.result !== 'success' || !json.rates || json.base_code !== 'USD') return readCache();

    const next = typeof json.time_next_update_unix === 'number' && json.time_next_update_unix > 0
      ? json.time_next_update_unix * 1000
      : 0;

    const cache: FxCache = { base: 'USD', rates: json.rates, fetchedAt: now, nextUpdateAt: next };
    writeCache(cache);
    return cache;
  } catch {
    return readCache();
  }
}

/**
 * Punto de entrada de la app: devuelve lo que haya en cache al instante y sólo
 * sale a la red si de verdad hace falta (más de una moneda en juego) y la
 * cache está vencida. Stale-while-revalidate: quien llama pinta con lo que
 * tiene y se actualiza cuando esto resuelve.
 */
export async function ensureRates(
  present: CurrencyCode[],
  display: CurrencyCode,
  now: number = Date.now(),
): Promise<FxCache | null> {
  const cache = readCache();
  if (!needsRates(present, display)) return cache;
  if (!isStale(cache, now)) return cache;
  return refreshRates(now);
}
