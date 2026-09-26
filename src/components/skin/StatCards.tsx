import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Typography } from '@/src/constants/typography';
import type { StatItem } from '@/src/components/Band';
import { useSkinTokens } from '@/src/skins/useSkin';
import { Panel } from './Panel';

/**
 * **Estadísticas como tarjetas sueltas** (Aero, PO 2026-09-26: «separá más
 * los bloques, hacelos redondos, no unidos»). Cada fila de `rows` es una
 * línea de tarjetas del mismo ancho, con aire entre ellas y entre filas.
 *
 * Solo tiene sentido con un skin `soft`: quien llama elige entre esto y la
 * banda de siempre (`StatLead`/`SplitStat`) según `skin.flags.soft`.
 */
export function StatCards({ rows, testID = 'stat-cards' }: { rows: StatItem[][]; testID?: string }) {
  const skin = useSkinTokens();
  const c = skin.colors;
  const gap = skin.space.gapPanel;

  return (
    <View testID={testID} style={{ paddingHorizontal: skin.space.inset, marginTop: gap, gap }}>
      {rows.map((fila, i) => (
        <View key={i} style={[styles.fila, { gap }]}>
          {fila.map(it => (
            <Panel
              key={it.label}
              testID="stat-card"
              style={{ flex: 1, marginHorizontal: 0, marginTop: 0 }}
            >
              <View style={{ padding: skin.space.padPanel, gap: 2 }}>
                <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>
                  {it.label}
                </Text>
                <Text
                  style={[Typography.amountM, { color: it.color ?? c.text }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                >
                  {it.value}
                </Text>
              </View>
            </Panel>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fila: { flexDirection: 'row' },
});
