import { getCurrency } from '@/src/constants/currencies';
import type { AppLang, CurrencyCode } from '@/src/constants/currencies';

/**
 * Dígitos máximos de un monto contando los decimales: el monto en unidades
 * menores es un entero y tiene que caber en `Number.MAX_SAFE_INTEGER`
 * (9.007e15, 16 dígitos). Con 15 cualquier combinación es segura.
 */
export const MAX_DIGITOS_MONTO = 15;

/** Mayor monto en unidades menores que alcanza el tope de dígitos. */
export const MAX_MONTO_MENOR = 10 ** MAX_DIGITOS_MONTO - 1;

/** Separador de miles del idioma; complemento del decimal, nunca coinciden. */
function grupoSep(lang: AppLang): string {
  return lang === 'en' ? ',' : '.';
}

/** Agrupa de a tres desde la derecha: miles, millones, miles de millones. */
function agruparMiles(digitos: string, lang: AppLang): string {
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, grupoSep(lang));
}

const esDigito = (ch: string) => ch >= '0' && ch <= '9';

function digitosDespuesDe(raw: string, idx: number): number {
  let n = 0;
  for (let i = idx + 1; i < raw.length; i++) if (esDigito(raw[i])) n++;
  return n;
}

/**
 * Posición del separador decimal dentro de `raw`, o -1 si no hay.
 *
 * El teclado `decimal-pad` muestra el separador de la REGIÓN del teléfono, no
 * el del idioma de la app (iPhone en México con la app en español → «.»), así
 * que el decimal se decide por la forma del texto, no sólo por el idioma:
 * - El propio del idioma es siempre decimal.
 * - El AJENO es decimal sólo si lo siguen 0..`decimals` dígitos (el usuario
 *   está tipeando o pegó «12.50»). Con 3 o más es agrupación («1.250»).
 * - Al BORRAR un carácter nunca se crea un decimal nuevo: «1.250» → «1.25» es
 *   agrupación a medio borrar, no 1,25.
 */
function indiceDecimal(raw: string, lang: AppLang, decimals: number, borrando: boolean): number {
  if (decimals === 0) return -1;
  const propio = lang === 'en' ? '.' : ',';
  const ajeno  = lang === 'en' ? ',' : '.';

  const iPropio = raw.indexOf(propio);
  const iAjeno  = raw.lastIndexOf(ajeno);
  const ajenoSirve = iAjeno !== -1 && !borrando && digitosDespuesDe(raw, iAjeno) <= decimals;

  if (iPropio === -1) return ajenoSirve ? iAjeno : -1;

  // Pegado en formato de otra región («1,250.50» en una app en español): el
  // ajeno viene DESPUÉS del propio y entre los dos hay exactamente un grupo de
  // 3 dígitos, o sea que el propio era agrupación.
  const entre = iAjeno > iPropio ? raw.slice(iPropio + 1, iAjeno) : '';
  if (ajenoSirve && /^\d{3}$/.test(entre)) return iAjeno;
  return iPropio;
}

/**
 * Sanitiza el texto tipeado con "decimales ACOTADOS" (PO 2026-07-20):
 * - Se admite HASTA `decimals` dígitos después del decimal; uno de más se
 *   descarta (se bloquea, no se acepta y redondea después).
 * - Una sola ocurrencia del decimal; el resto de los separadores se descarta.
 * - El usuario NUNCA tipea miles: se re-agrupan solos con el separador del
 *   idioma (PO 2026-08-30), y el decimal se normaliza al del idioma para que
 *   el texto sea siempre re-parseable por `parseMoney(text, code, lang)`.
 * - Monedas sin decimales (CLP/PYG): «.» y «,» se tratan como miles y se
 *   descartan; sólo cuentan los dígitos.
 * - Tope de `MAX_DIGITOS_MONTO` dígitos en total (T-254).
 *
 * `prev` es el texto anterior del input: sólo sirve para reconocer un borrado.
 */
export function sanitizeTypedAmount(
  raw: string, code: CurrencyCode, lang: AppLang, prev?: string,
): string {
  const decimals = getCurrency(code).decimals;
  const dec = lang === 'en' ? '.' : ',';
  const borrando = prev !== undefined && raw.length === prev.length - 1;
  const iDec = indiceDecimal(raw, lang, decimals, borrando);

  let intPart = '';
  let fracPart = '';
  for (let i = 0; i < raw.length; i++) {
    if (!esDigito(raw[i])) continue;
    if (iDec === -1 || i < iDec) intPart += raw[i];
    else if (fracPart.length < decimals) fracPart += raw[i];
  }

  // Ceros a la izquierda: sin esto "0001500" se agruparía como "0.001.500".
  const enteros = intPart.replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITOS_MONTO - decimals);
  const agrupado = agruparMiles(enteros, lang);
  return iDec === -1 ? agrupado : `${agrupado}${dec}${fracPart}`;
}
