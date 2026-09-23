import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Band } from '@/src/components/Band';
import { FondoMarmol } from '@/src/components/FondoMarmol';
import { MontoRodante } from '@/src/components/MontoRodante';
import type { CurrencyCode } from '@/src/constants/currencies';

/**
 * "Total" (PO 2026-09-22): la sumatoria neta de los grupos QUE SE VEN AHORA —
 * cuenta separada para activos y archivados, cambia con la pestaña. Distinto
 * de los 4 casilleros de arriba, que son fijos. `noTop`: pegada a la banda
 * de arriba, un solo borde entre las dos. Mármol patrón "franja" (tercera
 * variante, no repite la del total de Grupos con la del header).
 */
export function GroupsNetTotal({ netTotal, cur }: { netTotal: number; cur: CurrencyCode }) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <Band noTop>
      <View testID="groups-net-total" style={styles.netTotalRow}>
        <FondoMarmol patron="franja" />
        <Text style={[Typography.label, styles.upper, styles.netTotalLabel, { color: c.text }]}>
          {t('groups.stat_net_total')}
        </Text>
        <MontoRodante
          id="groups.netTotal"
          minor={netTotal}
          code={cur}
          prefix={netTotal < 0 ? '-' : ''}
          style={[
            Typography.amountM,
            { color: netTotal === 0 ? c.text : netTotal > 0 ? c.semantic.positive : c.semantic.negative },
          ]}
        />
      </View>
    </Band>
  );
}

const styles = StyleSheet.create({
  upper: { textTransform: 'uppercase' },
  netTotalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    overflow: 'hidden',
    // El label arranca alineado con el NOMBRE de cada grupo de arriba, no con
    // el borde de la pantalla (PO 2026-09-22): mismo offset que `GroupCard`
    // (tile 38 + gap 13), para que "Total" se lea como el pie de la lista, no
    // como una fila suelta.
    paddingLeft: Spacing.screenPad + 38 + 13,
    paddingRight: Spacing.screenPad,
    paddingVertical: Spacing[4],
  },
  netTotalLabel: { fontWeight: '800' },
});
