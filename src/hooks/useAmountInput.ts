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

  // T-255: si la moneda cambia con un monto tipeado, se conserva el VALOR y se
  // re-expresa en los decimales de la nueva (ARS 12,50 → CLP 13). Se ajusta
  // durante el render, así nunca se pinta el texto viejo bajo la moneda nueva.
  const [codePrevio, setCodePrevio] = useState(code);
  if (codePrevio !== code) {
    setCodePrevio(code);
    if (text) {
      const valor = parseMoney(text, codePrevio, lang) / (10 ** getCurrency(codePrevio).decimals);
      const nuevo = Math.round(valor * (10 ** getCurrency(code).decimals));
      setText(nuevo ? formatForEditing(nuevo, code, lang) : '');
    }
  }

  const onChangeText = useCallback((raw: string) => {
    setText(prev => sanitizeTypedAmount(raw, code, lang, prev));
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
