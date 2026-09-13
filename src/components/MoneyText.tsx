import { Text, type TextProps, type StyleProp, type TextStyle } from 'react-native';
import { formatMoney, type CurrencyCode } from '@/src/constants/currencies';
import { MontoRodante } from '@/src/components/MontoRodante';
import type { MontoRegistry } from '@/src/utils/montoRodanteRegistry';

interface MoneyTextProps extends TextProps {
  /** Entero en menor unidad (nunca float de la unidad real). */
  minor: number;
  code: CurrencyCode;
  /** Signo u otro prefijo pegado al monto, ej '+' o '-'. */
  prefix?: string;
  suffix?: string;
  style?: StyleProp<TextStyle>;
  /** Mínimo al que puede achicarse la fuente antes de rendirse (0–1). */
  minimumFontScale?: number;
  /**
   * Sólo para los MONTOS GRANDES DE BLOQUE (T-106, nunca en filas de listas):
   * pasa esto para que el número "ruede" (`MontoRodante`) en vez de aparecer
   * directo. Es la clave de identidad estable de esta posición en pantalla —
   * ver `montoRodanteRegistry`. Sin `rollId`, MoneyText se comporta EXACTO
   * como siempre (default, sin romper ningún uso existente).
   */
  rollId?: string;
  /** Sólo para tests: registro inyectable de `MontoRodante`. */
  registry?: MontoRegistry;
}

/**
 * Renderiza un monto formateado en UNA sola línea. En pantallas angostas achica
 * la fuente en vez de cortar el número entre sus dígitos/decimales o separar el
 * signo `$` del número. Envuelve símbolo + monto + signo en un único Text para
 * que nunca se quiebren entre sí.
 */
export function MoneyText({
  minor, code, prefix = '', suffix = '',
  style, minimumFontScale = 0.6, rollId, registry, ...rest
}: MoneyTextProps) {
  if (rollId) {
    // `suffix` no tiene equivalente en `MontoRodante` (nadie lo combina con
    // `rollId` hoy — ningún call site pasa las dos cosas juntas).
    return (
      <MontoRodante
        id={rollId} minor={minor} code={code} prefix={prefix}
        style={style} registry={registry} testID={rest.testID}
      />
    );
  }

  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={minimumFontScale}
      style={style}
      {...rest}
    >
      {prefix}{formatMoney(minor, code)}{suffix}
    </Text>
  );
}
