import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Spacing } from '@/src/constants/spacing';
import { useSkinTokens } from '@/src/skins/useSkin';
import { MarmolPill } from '@/src/components/skin/MarmolPill';
import { hapticSelection } from '@/src/utils/haptics';
import { monthLabel, nextMonth, prevMonth } from '@/src/screens/personal/utils/monthLabel';

/**
 * Navegador de mes de Personal — mármol de fondo, patrón "franja" (PO
 * 2026-09-22): tercera variante, para no repetir la del header ni la de
 * Movimientos en la misma pantalla.
 */
export function PersonalMonthNav({
  activeMonth, atCurrentMonth, onChangeMonth,
}: {
  activeMonth: string;
  atCurrentMonth: boolean;
  onChangeMonth: (month: string) => void;
}) {
  const skin = useSkinTokens();
  const c = skin.colors;

  return (
    <MarmolPill testID="month-nav" patron="franja" style={styles.monthNav}>
      <Pressable onPress={() => { hapticSelection(); onChangeMonth(prevMonth(activeMonth)); }} hitSlop={12}>
        <Ionicons name="chevron-back" size={19} color={c.textSecondary} />
      </Pressable>
      <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }}>
        {monthLabel(activeMonth)}
      </Text>
      <Pressable
        onPress={() => { hapticSelection(); onChangeMonth(nextMonth(activeMonth)); }}
        disabled={atCurrentMonth}
        hitSlop={12}
        style={{ opacity: atCurrentMonth ? 0.3 : 1 }}
      >
        <Ionicons name="chevron-forward" size={19} color={c.textSecondary} />
      </Pressable>
    </MarmolPill>
  );
}

const styles = StyleSheet.create({
  monthNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    overflow: 'hidden',
    // T-121+: paddingTop repone el aire que daba la fila de ajustes (movida
    // al header, PO 2026-09-20) — sin esto el navegador de mes queda pegado
    // al bloque de deuda de arriba.
    paddingHorizontal: Spacing.screenPad, paddingTop: 14, paddingBottom: 16,
  },
});
