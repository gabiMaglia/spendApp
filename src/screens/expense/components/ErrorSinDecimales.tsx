import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Typography } from '@/src/constants/typography';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useColors } from '@/src/skins/useSkin';

/**
 * Aviso junto al monto cuando la moneda no usa decimales (CLP/PYG) y el texto
 * los trae (T-258). Compartido por Aero y Clásico: el texto nunca se redondea
 * solo, así que quien escribió «12,50» tiene que ver por qué no puede guardar.
 */
export function ErrorSinDecimales({ currency }: { currency: CurrencyCode }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <Text
      testID="amount-no-decimals"
      accessibilityRole="alert"
      style={[Typography.caption, styles.texto, { color: c.semantic.negative }]}
    >
      {t('expense.no_decimals', { currency: t(`currency_names.${currency}`) })}
    </Text>
  );
}

const styles = StyleSheet.create({ texto: { textAlign: 'center' } });
