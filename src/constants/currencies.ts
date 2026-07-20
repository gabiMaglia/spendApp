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

// Formatea un monto (ENTERO en menor unidad) con Intl.NumberFormat — SIEMPRE
// usar esto, nunca .toFixed() ni división/multiplicación manual. Usa el `locale`
// de la MONEDA (no el idioma de la app) — es de salida, no de entrada (F-16b.1).
export function formatAmount(minor: number, code: CurrencyCode): string {
  const currency = getCurrency(code);
  const value = minor / minorFactor(code);
  return new Intl.NumberFormat(currency.locale, {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
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
