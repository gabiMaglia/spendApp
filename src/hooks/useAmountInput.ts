import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCachedNumberFormat, getCurrency, parseMoney } from '@/src/constants/currencies';
import type { AppLang, CurrencyCode } from '@/src/constants/currencies';
import { sanitizeTypedAmount } from '@/src/hooks/sanitizeAmount';

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
  // Mismo cache de módulo que `formatMoney` (T-198) — el locale de EDICIÓN
  // es distinto del de salida, pero el espacio de claves sigue siendo chico
  // y fijo, así que comparte el `Map` en vez de tener el suyo propio.
  return getCachedNumberFormat(EDIT_LOCALE[lang], decimals).format(value);
}

const decimalDe = (lang: AppLang) => (lang === 'en' ? '.' : ',');

/** Parte del texto que sigue al decimal del idioma, solo si la moneda no admite decimales. */
function fraccionSobrante(text: string, code: CurrencyCode, lang: AppLang): string {
  if (getCurrency(code).decimals !== 0) return '';
  const i = text.lastIndexOf(decimalDe(lang));
  return i === -1 ? '' : text.slice(i + 1).replace(/\D/g, '');
}

/** CLP/PYG con centavos distintos de cero: no hay valor exacto que guardar. */
function tieneFraccion(text: string, code: CurrencyCode, lang: AppLang): boolean {
  return /[1-9]/.test(fraccionSobrante(text, code, lang));
}

/** Para monedas sin decimales, el texto sin «,50» (los ceros «12,00» valen 12 exacto). */
function textoSinFraccion(text: string, code: CurrencyCode, lang: AppLang): string {
  if (getCurrency(code).decimals !== 0) return text;
  const i = text.lastIndexOf(decimalDe(lang));
  return i === -1 ? text : text.slice(0, i);
}

export interface UseAmountInputResult {
  /** La moneda no usa decimales y el texto los trae: el monto no se puede guardar así (T-258). */
  decimalesNoAdmitidos: boolean;
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

  // T-258: al cambiar de moneda el texto NO se toca (nada de redondear lo que
  // el usuario escribió). Si la moneda nueva no tiene decimales y el texto los
  // trae, se avisa (`decimalesNoAdmitidos`) y la pantalla no deja guardar.
  const decimalesNoAdmitidos = tieneFraccion(text, code, lang);

  const onChangeText = useCallback((raw: string) => {
    setText(prev => {
      // En CLP/PYG, con centavos ya en el texto o pegando un monto con coma,
      // se sanea como moneda con decimales: fusionar dígitos ("12,50"+"5" →
      // 12.505, "1500,99" → 150.099) cambiaría el monto en silencio. Tipear una
      // coma en un monto entero sigue bloqueado.
      const dec = decimalDe(lang);
      const pegado = raw.length - prev.length > 1 && new RegExp(`\\${dec}\\d`).test(raw);
      const corrigiendo = getCurrency(code).decimals === 0 && (prev.includes(dec) || pegado);
      return sanitizeTypedAmount(raw, corrigiendo ? 'USD' : code, lang, prev);
    });
  }, [code, lang]);

  // El blur interpreta el texto en la moneda ACTUAL (sin reescalar): el mismo
  // valor que expone `minor`.
  const minor = parseMoney(textoSinFraccion(text, code, lang), code, lang);

  const onBlur = useCallback(() => {
    if (decimalesNoAdmitidos) return; // reformatear acá cambiaría lo escrito
    setText(minor === 0 ? '' : formatForEditing(minor, code, lang));
  }, [minor, code, lang, decimalesNoAdmitidos]);

  const setMinor = useCallback((minor: number) => {
    setText(minor ? formatForEditing(minor, code, lang) : '');
  }, [code, lang]);

  return { text, minor, decimalesNoAdmitidos, onChangeText, onBlur, setMinor };
}
