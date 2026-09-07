export const SUPPORTED_CURRENCIES = [
  { code: 'ARS', symbol: '$',   name: 'Peso argentino',       decimals: 2, locale: 'es-AR' },
  { code: 'USD', symbol: 'US$', name: 'Dólar estadounidense', decimals: 2, locale: 'en-US' },
  { code: 'EUR', symbol: '€',   name: 'Euro',                 decimals: 2, locale: 'es-ES' },
  { code: 'BRL', symbol: 'R$',  name: 'Real brasilero',       decimals: 2, locale: 'pt-BR' },
  { code: 'CLP', symbol: '$',   name: 'Peso chileno',         decimals: 0, locale: 'es-CL' },
  { code: 'BOB', symbol: 'Bs.', name: 'Boliviano',            decimals: 2, locale: 'es-BO' },
  { code: 'PYG', symbol: '₲',   name: 'Guaraní paraguayo',   decimals: 0, locale: 'es-PY' },
  { code: 'UYU', symbol: '$U',  name: 'Peso uruguayo',        decimals: 2, locale: 'es-UY' },
  { code: 'PEN', symbol: 'S/',  name: 'Sol peruano',          decimals: 2, locale: 'es-PE' },
] as const;

export type CurrencyCode = typeof SUPPORTED_CURRENCIES[number]['code'];

export function getCurrency(code: CurrencyCode) {
  return SUPPORTED_CURRENCIES.find(c => c.code === code)!;
}

// CLP y PYG no usan decimales — bloquear el separador decimal en inputs numéricos
export function hasDecimals(code: CurrencyCode): boolean {
  return getCurrency(code).decimals > 0;
}

// ── ADR-002 — representación monetaria en enteros (menor unidad) ────────────

/** Idioma de la app — determina el separador decimal en el INPUT (F-16b.1). */
export type AppLang = 'es' | 'en' | 'pt';

/**
 * Factor para convertir entre la unidad real de una moneda y su "menor unidad"
 * (cents, o la unidad entera para monedas sin decimales). Fuente única: `decimals`
 * en SUPPORTED_CURRENCIES. CLP/PYG (decimals:0) → factor 1. El resto (decimals:2) → 100.
 */
export function minorFactor(code: CurrencyCode): number {
  return 10 ** getCurrency(code).decimals;
}

/**
 * Conversión ONE-SHOT de un monto FLOAT ya existente (unidad real, p.ej. datos
 * guardados en MMKV antes de ADR-002) a entero en menor unidad. Distinto de
 * `parseMoney`: no interpreta texto tipeado por el usuario, solo escala un
 * `number` ya numérico. Usado por la migración de datos (ADR-002 §6).
 */
export function toMinorUnits(amount: number, code: CurrencyCode): number {
  return Math.round(amount * minorFactor(code));
}

/**
 * **El locale con el que se formatea: uno solo, el del idioma de la app.**
 *
 * Hasta el 2026-09-02 se usaba el locale de cada MONEDA (F-16b.1, que el
 * backlog registra como «asimetría entrada/salida aceptada»). El resultado en
 * pantalla lo destruye: en la misma lista de balances, `US$1,234.56` y
 * `€1234,56` — **la coma significa "miles" en una fila y "decimales" en la de
 * abajo**. El PO lo levantó viéndolo renderizado.
 *
 * Y era asimétrico con la entrada: `parseMoney` ya toma el separador decimal
 * del IDIOMA (es/pt → coma, en → punto), así que tipeabas `1234,56` con coma
 * decimal y la app te devolvía `US$1,234.56` con coma de miles. El mismo número
 * escrito de dos formas por la misma app.
 *
 * **No hay una convención mundial que copiar.** ISO 80000-1 recomienda espacio
 * fino para los miles justamente porque coma y punto son ambiguos entre países,
 * y admite las dos como marca decimal. El mundo está partido: coma-miles en
 * EE.UU., Reino Unido, México, Perú, Japón y China; punto-miles en Alemania,
 * España y casi toda Sudamérica; espacio en Francia y Rusia. Lo único
 * defendible es ser **consistente para quien mira**: la moneda aporta el
 * símbolo y cuántos decimales, el lector aporta cómo se agrupan los dígitos.
 *
 * Un locale canónico por idioma, no por país: la app soporta tres idiomas, no
 * veinte regiones, e inventar más precisión de la que hay sería falsa.
 */
const LOCALE_DE_SALIDA: Record<AppLang, string> = {
  es: 'es-AR',   // punto miles, coma decimal
  en: 'en-US',   // coma miles, punto decimal
  pt: 'pt-BR',   // punto miles, coma decimal
};

let idiomaDeSalida: AppLang = 'es';

/**
 * Fija el idioma con el que se formatea la plata. Lo llama la capa de i18n al
 * arrancar y en cada cambio de idioma.
 *
 * Es una variable de módulo y no un `import` de i18n a propósito: `src/i18n`
 * arrastra `expo-localization`, que es nativo, y este archivo lo importan los
 * stores y el camino del sync. Meter un módulo nativo ahí es lo que ya tumbó la
 * app entera dos veces (ver `src/services/avatar.ts`).
 */
export function setFormatLanguage(lang: AppLang): void {
  idiomaDeSalida = lang;
}

export function getFormatLanguage(): AppLang {
  return idiomaDeSalida;
}

/**
 * Formatea un monto (ENTERO en menor unidad) con `Intl.NumberFormat` — SIEMPRE
 * usar esto, nunca `.toFixed()` ni división/multiplicación manual.
 *
 * **Los centavos en cero no se muestran** (PO 2026-09-02): `$1.234,00` sale
 * como `$1.234`, y `$1.234,50` se mantiene entero. La mayoría de los montos de
 * la app son redondos, y dos ceros repetidos en cada fila de una lista son
 * ruido que compite con los dígitos que sí cambian.
 *
 * **No se pierde precisión ni se rompe el ida y vuelta**: el valor guardado
 * sigue siendo el entero en menor unidad, y `parseMoney` de un texto sin
 * separador decimal devuelve exactamente ese entero (regla 3 de F-16b: «sin
 * separador → sin decimales»). El test de invariante lo exige.
 */
export function formatAmount(minor: number, code: CurrencyCode): string {
  const currency = getCurrency(code);
  const value = minor / minorFactor(code);

  /**
   * Se decide sobre el ENTERO en menor unidad, que es el valor de registro.
   *
   * Con las monedas de hoy —0 o 2 decimales— mirar el float daría lo mismo:
   * dividir un entero por 100 dentro del rango seguro es exacto. Una mutación
   * que lo cambiaba a `value % 1 === 0` sobrevivió a la suite, y es correcto
   * que sobreviva. Se deja sobre el entero igual porque no depende de esa
   * garantía: el día que entre una moneda de 3 decimales, o que un cálculo
   * llegue arriba de 2^53, sigue siendo obviamente cierto sin tener que
   * volver a razonarlo.
   */
  const sinCentavos = currency.decimals === 0
    || minor % minorFactor(code) === 0;

  const decimales = sinCentavos ? 0 : currency.decimals;

  return new Intl.NumberFormat(LOCALE_DE_SALIDA[idiomaDeSalida], {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(Math.abs(value));
}

// Devuelve símbolo + monto formateado, ej: "$1.500,00". `minor` es SIEMPRE el
// entero en menor unidad (nunca un float de la unidad real).
export function formatMoney(minor: number, code: CurrencyCode): string {
  const currency = getCurrency(code);
  return `${currency.symbol}${formatAmount(minor, code)}`;
}

/**
 * Parsea el texto crudo de un input de monto a un ENTERO en menor unidad.
 * Contrato endurecido por F-16b (ver ADR-002 §3). El separador decimal se
 * determina por el IDIOMA de la app (`lang`), NUNCA por el locale de la moneda:
 * es/pt → coma `,`; en → punto `.`. El separador de miles es el otro carácter
 * y se acepta/ignora.
 *
 * Reglas:
 * - Monedas sin decimales (CLP/PYG): se descarta cualquier separador, solo
 *   dígitos → entero directo.
 * - Monedas con decimales: la parte decimal es la ÚLTIMA ocurrencia de `dec`
 *   en el texto (evita el bug de tratar un separador de miles mal tipeado
 *   como decimal, p.ej. es-AR `150.00,23` → NO pierde los centavos).
 * - Se permiten más decimales de los que soporta la moneda al tipear; se
 *   redondea a los `decimals` de la moneda al convertir (Math.round).
 *
 * El canónico interno siempre usa `.` como decimal antes del Math.round.
 */
export function parseMoney(text: string, code: CurrencyCode, lang: AppLang): number {
  const currency = getCurrency(code);
  const decimals = currency.decimals;

  if (decimals === 0) {
    const digits = text.replace(/[^0-9]/g, '');
    return digits ? Math.round(Number(digits)) : 0;
  }

  const dec = lang === 'en' ? '.' : ',';
  // (thou no se usa explícitamente: se descarta junto con cualquier no-dígito)

  const lastDecIdx = text.lastIndexOf(dec);
  const intPartRaw  = lastDecIdx === -1 ? text : text.slice(0, lastDecIdx);
  const fracPartRaw = lastDecIdx === -1 ? ''   : text.slice(lastDecIdx + 1);

  const intDigits  = intPartRaw.replace(/[^0-9]/g, '');
  const fracDigits = fracPartRaw.replace(/[^0-9]/g, '');

  const canonical = `${intDigits || '0'}.${fracDigits || '0'}`;
  const value = Number(canonical);
  if (!Number.isFinite(value)) return 0;

  return Math.round(value * minorFactor(code));
}

/**
 * Escala fija de `Payment.exchangeRate` (ADR-002 §6). No es un monto en una
 * moneda — es un ratio — así que NO usa `minorFactor`: `exchangeRate`
 * almacenado = ratio_real * RATE_SCALE (entero).
 *
 * **Vive acá y no en `calculateBalances` por una razón de estructura, no de
 * prolijidad.** `moneyMigration` la necesita, y `moneyMigration` lo importa
 * `expenseStore`, que está en el grafo del sobre de sync: con la constante
 * declarada dentro del módulo de balances, TODO ese módulo quedaba a un import
 * de distancia del cable, y con él la canonicalización de identidades de T-048.
 * Lo destapó el guard `canonicalNoAlcanzaElCable.test.ts`, que es exactamente
 * para lo que existe.
 */
export const RATE_SCALE = 1_000_000;
