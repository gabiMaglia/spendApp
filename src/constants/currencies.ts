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

// Formatea un monto con Intl.NumberFormat — SIEMPRE usar esto, nunca .toFixed() directo
export function formatAmount(amount: number, code: CurrencyCode): string {
  const currency = getCurrency(code);
  return new Intl.NumberFormat(currency.locale, {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  }).format(Math.abs(amount));
}

// Devuelve símbolo + monto formateado, ej: "$1.500,00"
export function formatMoney(amount: number, code: CurrencyCode): string {
  const currency = getCurrency(code);
  return `${currency.symbol}${formatAmount(amount, code)}`;
}

// CLP y PYG no usan decimales — bloquear el punto en inputs numéricos
export function hasDecimals(code: CurrencyCode): boolean {
  return getCurrency(code).decimals > 0;
}
