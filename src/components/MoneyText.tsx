import { Text, type TextProps, type StyleProp, type TextStyle } from 'react-native';
import { formatMoney, type CurrencyCode } from '@/src/constants/currencies';

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
}

/**
 * Renderiza un monto formateado en UNA sola línea. En pantallas angostas achica
 * la fuente en vez de cortar el número entre sus dígitos/decimales o separar el
 * signo `$` del número. Envuelve símbolo + monto + signo en un único Text para
 * que nunca se quiebren entre sí.
 */
export function MoneyText({
  minor, code, prefix = '', suffix = '',
  style, minimumFontScale = 0.6, ...rest
}: MoneyTextProps) {
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
