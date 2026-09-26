import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useSkinTokens } from '@/src/skins/useSkin';
import { MarmolPill } from '@/src/components/skin/MarmolPill';

/**
 * **Encabezado pegajoso de "Movimientos"** (PO 2026-09-20): mismo mármol que
 * el header (`FondoMarmol`), para que la lista que pasa por debajo nunca se
 * transparente. Sube a `stickyHeaderIndices` del `ScrollView` de la pantalla
 * — el frame del scroll ya arranca justo debajo de la barra colapsada del
 * header (`useLimiteContenido`), así que "pegarse arriba del todo" nunca lo
 * tapa ni lo pisa, sólo llega hasta ese borde y se queda ahí.
 */
export function MovimientosHeader({ count }: { count: number }) {
  const skin = useSkinTokens();
  const c = skin.colors;
  // En un skin soft la píldora ya separa el encabezado de la lista: sin hairline.
  // Y el aire vertical es simétrico: el Spacing[5]/9 de abajo está afinado
  // para la banda plana (corte de reposo del scroll), no para una píldora.
  // Borde (PO 2026-09-26): la píldora sticky no lleva sombra —ensuciaría el
  // scroll—, así que el contorno es lo que la recorta contra la lista.
  // `borderTopColor` explícito: si no, gana el filo de luz de `MarmolPill`.
  const extra = skin.flags.soft
    ? {
        paddingTop: skin.space.gapInline, paddingBottom: skin.space.gapInline,
        borderWidth: 1, borderColor: c.hair, borderTopColor: c.hair,
      }
    : { borderBottomWidth: 1, borderBottomColor: c.hair };
  const { t } = useTranslation();
  return (
    <MarmolPill testID="movimientos-header" variante sticky style={[styles.movimientosHeader, extra]}>
      <Text style={[Typography.label, styles.movimientosBold, { color: c.textTertiary }]}>
        {t('personal.movements_title')}
      </Text>
      <Text style={[Typography.amountS, styles.movimientosBold, { color: c.text }]}>
        {count}
      </Text>
    </MarmolPill>
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
  },
  movimientosBold: { fontWeight: '800' },
});
