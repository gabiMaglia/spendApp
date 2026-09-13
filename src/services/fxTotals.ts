import type { CurrencyCode } from '@/src/constants/currencies';
import { convertMinor, type FxCache } from './fx';

export type Bucket = { currency: CurrencyCode; minor: number };

export type SumResult = {
  /** Total en la moneda elegida, con TODO lo que se pudo convertir. */
  totalMinor: number;
  /**
   * Lo que quedó afuera, agrupado por su moneda original.
   *
   * Existe para que la pantalla pueda distinguir "no gastaste nada" de "no te
   * puedo mostrar lo que gastaste". Si esto no viniera vacío y el total se
   * mostrara a secas, el usuario vería un número más chico que la realidad sin
   * ninguna señal — que es exactamente el defecto que estamos arreglando.
   */
  unconverted: Bucket[];
  /**
   * T-109: **todavía no bajamos NINGUNA cotización** (cache null, hay un
   * fetch en vuelo) — distinto de `unconverted`, que es "la tasa no existe".
   * `convertMinor` ya devuelve `null` en los dos casos por motivos distintos
   * (`!cache` acá, `!rateOk` allá); esto sólo expone cuál de los dos fue.
   * La pantalla usa esto para mostrar `--` sin animar en vez de un total
   * parcial que después salta al real (la "doble animación" que reportó el
   * PO) — nunca para el aviso de tasa faltante, que sigue siendo `unconverted`.
   */
  pending: boolean;
};

/**
 * Suma una lista de montos de distintas monedas en la moneda elegida.
 *
 * Lo que no se puede convertir NO se suma como 0: se devuelve aparte, en su
 * moneda original, para que la pantalla lo informe (el PO pidió un modal).
 * El orden de `unconverted` es estable —primera aparición— para que la lista
 * no baile entre renders.
 */
export function sumConverted(
  buckets: Bucket[],
  display: CurrencyCode,
  cache: FxCache | null,
): SumResult {
  let totalMinor = 0;
  const pendientes = new Map<CurrencyCode, number>();

  for (const b of buckets) {
    const convertido = convertMinor(b.minor, b.currency, display, cache);
    if (convertido === null) {
      pendientes.set(b.currency, (pendientes.get(b.currency) ?? 0) + b.minor);
    } else {
      totalMinor += convertido;
    }
  }

  return {
    totalMinor,
    unconverted: Array.from(pendientes, ([currency, minor]) => ({ currency, minor })),
    // `unconverted` no distingue POR QUÉ quedó afuera. Cuando la causa es
    // "no hay cache todavía" (fetch en vuelo), la pantalla lo trata como
    // pendiente (placeholder `--`, sin animar) mientras `useFx` siga
    // cargando; si el fetch ya terminó y sigue sin cache, la pantalla cae al
    // aviso de siempre (`UnconvertedNotice`) — por eso `pending` es sólo un
    // dato adicional, `unconverted` se sigue calculando igual que antes.
    pending: cache === null && pendientes.size > 0,
  };
}
