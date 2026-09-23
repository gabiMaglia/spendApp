import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FondoMarmol } from '@/src/components/FondoMarmol';

/**
 * **Encabezado pegajoso de "Movimientos"** (PO 2026-09-20): mismo mármol que
 * el header (`FondoMarmol`), para que la lista que pasa por debajo nunca se
 * transparente. Sube a `stickyHeaderIndices` del `ScrollView` de la pantalla
 * — el frame del scroll ya arranca justo debajo de la barra colapsada del
 * header (`useLimiteContenido`), así que "pegarse arriba del todo" nunca lo
 * tapa ni lo pisa, sólo llega hasta ese borde y se queda ahí.
 */
export function MovimientosHeader({ count }: { count: number }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { t } = useTranslation();
  return (
    <View testID="movimientos-header" style={[styles.movimientosHeader, { borderBottomColor: c.hair }]}>
      <FondoMarmol variante />
      <Text style={[Typography.label, styles.movimientosBold, { color: c.textTertiary }]}>
        {t('personal.movements_title')}
      </Text>
      <Text style={[Typography.amountS, styles.movimientosBold, { color: c.text }]}>
        {count}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  movimientosHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    overflow: 'hidden',
    // paddingTop Spacing[8]→Spacing[5] (PO 2026-09-22): con poco contenido en
    // el mes, el corte de reposo del scroll (sin scrollear) caía justo acá —
    // se veía el mármol pero no el texto, porque el texto quedaba centrado
    // más abajo del punto de corte. Menos aire arriba corre el bloque hacia
    // arriba lo suficiente para que quede completo antes del corte.
    paddingHorizontal: Spacing.screenPad, paddingTop: Spacing[5], paddingBottom: 9,
    borderBottomWidth: 1,
  },
  movimientosBold: { fontWeight: '800' },
});
