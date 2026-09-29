import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { Band } from '@/src/components/Band';
import { FondoMarmol } from '@/src/components/FondoMarmol';
import { MontoRodante } from '@/src/components/MontoRodante';
import type { CurrencyCode } from '@/src/constants/currencies';
import { useColors } from '@/src/skins/useSkin';

/**
 * Fila de total: banda con mármol «franja», etiqueta en versalitas y el monto
 * verde/rojo/neutro según el signo. Nació como el pie de Grupos (PO
 * 2026-09-22) y T-225 la reusa como balance neto al pie del detalle de grupo:
 * el mismo número (te deben − debés) se lee igual en los dos lugares.
 *
 * `sangria` alinea la etiqueta con el texto de las filas de arriba (que tienen
 * un ícono a la izquierda), para que se lea como el pie de esa lista.
 */
export function FilaDeTotal({
  label, minor, code, montoId, testID, sangria = 0,
}: {
  label: string;
  minor: number;
  code: CurrencyCode;
  /** Clave de `MontoRodante`: con ella el monto rueda al cambiar. */
  montoId: string;
  testID?: string;
  sangria?: number;
}) {
  const c = useColors();
  const color = minor === 0 ? c.text : minor > 0 ? c.semantic.positive : c.semantic.negative;

  return (
    <Band noTop>
      <View testID={testID} style={[styles.row, { paddingLeft: Spacing.screenPad + sangria }]}>
        <FondoMarmol patron="franja" />
        <Text style={[Typography.label, styles.label, { color: c.text }]}>{label}</Text>
        <MontoRodante
          id={montoId}
          minor={minor}
          code={code}
          prefix={minor < 0 ? '-' : ''}
          style={[Typography.amountM, { color }]}
        />
      </View>
    </Band>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    overflow: 'hidden',
    paddingRight: Spacing.screenPad,
    paddingVertical: Spacing[4],
  },
  label: { textTransform: 'uppercase', fontWeight: '800' },
});
