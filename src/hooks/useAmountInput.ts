import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrency, parseMoney } from '@/src/constants/currencies';
import type { AppLang, CurrencyCode } from '@/src/constants/currencies';

// Locale sintético usado SOLO para re-mostrar el texto del input mientras se
// edita (on-blur) — deliberadamente basado en el IDIOMA de la app (no en el
// `locale` de la moneda) para que el texto mostrado sea SIEMPRE re-parseable
// por `parseMoney(text, code, lang)` con el mismo `lang`. Si usáramos el
// locale de la moneda acá (p.ej. en-US para USD con la app en español).
// mostrar "1,500.00" y re-parsearlo con lang='es' (decimal=',') rompería el
// monto — exactamente la clase de bug que este ticket corrige. `formatMoney`/
// `formatAmount` (locale de moneda) quedan reservados para vistas de SOLO
// LECTURA (splits, balances, detalle de gasto), nunca para el texto editable
// de un input.
const EDIT_LOCALE: Record<AppLang, string> = { es: 'es-AR', en: 'en-US', pt: 'pt-BR' };

function formatForEditing(minor: number, code: CurrencyCode, lang: AppLang): string {
  const decimals = getCurrency(code).decimals;
  const value = minor / (10 ** decimals);
  return new Intl.NumberFormat(EDIT_LOCALE[lang], {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Sanitiza el texto tipeado con "decimales ACOTADOS" (corrección PO 2026-07-20,
 * reemplaza "decimales libres + redondeo" — F-16b.3 / `01_requirements.md:72`):
 * - Sin separador decimal tipeado → solo dígitos de la parte entera (sin
 *   fracción; `parseMoney` interpreta esto como el monto entero exacto,
 *   `"150"` → $150,00).
 * - Al tipear el separador decimal del idioma, se admite HASTA `decimals`
 *   dígitos después; un dígito de más se DESCARTA (se bloquea, no se acepta
 *   y redondea después).
 * - Solo se admite UNA ocurrencia del separador decimal; ocurrencias
 *   adicionales se descartan.
 * - El usuario NUNCA tipea separador de miles: se descarta lo que escriba y se
 *   RE-AGRUPA solo (PO 2026-08-30). Antes la agrupación aparecía únicamente
 *   on-blur, así que al tipear "1500000" se veía "1500000" y no había forma de
 *   saber si eran un millón y medio o quince millones sin contar ceros de a
 *   uno — con PYG o CLP, donde un gasto normal tiene 7 dígitos, es peor.
 * - Monedas sin decimales (CLP/PYG): el separador decimal queda bloqueado
 *   por completo — todo lo que no sea dígito se descarta.
 */
/**
 * Separador de miles del idioma. Es el complemento del decimal: donde el
 * decimal es coma, los miles son punto, y al revés. Nunca pueden coincidir o
 * el texto dejaría de ser re-parseable.
 */
function grupoSep(lang: AppLang): string {
  return lang === 'en' ? ',' : '.';
}

/** Agrupa de a tres desde la derecha: miles, millones, miles de millones. */
function agruparMiles(digitos: string, lang: AppLang): string {
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, grupoSep(lang));
}

function sanitizeTypedAmount(raw: string, code: CurrencyCode, lang: AppLang): string {
  const decimals = getCurrency(code).decimals;
  const dec = lang === 'en' ? '.' : ',';

  let intPart = '';
  let fracPart = '';
  let seenDec = false;

  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      if (!seenDec) intPart += ch;
      else if (fracPart.length < decimals) fracPart += ch;
      // si ya se alcanzó el tope de decimales de la moneda, el dígito se
      // descarta — es el bloqueo del "3er decimal" pedido por el PO.
    } else if (ch === dec && !seenDec && decimals > 0) {
      seenDec = true;
    }
    // cualquier otro carácter (separador de miles, letras, etc.) se descarta
  }

  // Ceros a la izquierda: sin esto "0001500" se agruparía como "0.001.500".
  // Se conserva un "0" solo, que es un monto válido mientras se escribe.
  const enteros = intPart.replace(/^0+(?=\d)/, '');
  const agrupado = agruparMiles(enteros, lang);

  return seenDec ? `${agrupado}${dec}${fracPart}` : agrupado;
}

export interface UseAmountInputResult {
  /** Texto crudo a mostrar en el TextInput (NO reformatear en cada tecla — F-16b.4). */
  text: string;
  /** Valor canónico — SIEMPRE entero en menor unidad. Es lo único que se persiste. */
  minor: number;
  /** Handler para onChangeText del TextInput. Bloquea el separador decimal si la moneda no tiene decimales (CLP/PYG). */
  onChangeText: (raw: string) => void;
  /** Handler para onBlur del TextInput — formatea el texto visible (no cambia `minor`). */
  onBlur: () => void;
  /** Re-inicializa el input (p.ej. al cambiar de moneda o cargar un monto existente para editar). */
  setMinor: (minor: number) => void;
}

/**
 * Encapsula el pipeline de ingreso de monto de F-16b/ADR-002 §3(e): texto
 * crudo mientras se tipea, formateo on-blur, canónico entero siempre
 * disponible vía `parseMoney`. Reutilizable por los 3 inputs de monto de la
 * app (expense/new, settle/new).
 */
export function useAmountInput(code: CurrencyCode, initialMinor = 0): UseAmountInputResult {
  const { i18n } = useTranslation();
  const lang = (i18n.language as AppLang) in EDIT_LOCALE ? (i18n.language as AppLang) : 'es';

  const [text, setText] = useState<string>(
    initialMinor ? formatForEditing(initialMinor, code, lang) : '',
  );

  const onChangeText = useCallback((raw: string) => {
    setText(sanitizeTypedAmount(raw, code, lang));
  }, [code, lang]);

  const onBlur = useCallback(() => {
    const minor = parseMoney(text, code, lang);
    setText(minor === 0 ? '' : formatForEditing(minor, code, lang));
  }, [text, code, lang]);

  const setMinor = useCallback((minor: number) => {
    setText(minor ? formatForEditing(minor, code, lang) : '');
  }, [code, lang]);

  const minor = parseMoney(text, code, lang);

  return { text, minor, onChangeText, onBlur, setMinor };
}
