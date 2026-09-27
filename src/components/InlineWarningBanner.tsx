import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColors } from '@/src/skins/useSkin';

/**
 * Banda de aviso inline en un detalle (banda, no tarjeta: hairline arriba y
 * abajo, sin radio, borde a borde — el patrón de T-107).
 *
 * Se extrae al SEGUNDO repetido (regla del proyecto): la ronda de borrado
 * consensuado (`app/expense/[id].tsx`) ya tenía este layout inline, y la
 * disputa de autoría (T-170 · D-3) lo necesita idéntico. `tone` decide entre
 * el rojo/ámbar de "algo requiere tu atención" (`warning`) y el gris de
 * "informativo, ya resuelto o neutral" (`neutral`) — el mismo criterio que
 * ya usaba la ronda (`frenada` vs abierta).
 */
export function InlineWarningBanner({
  icon, title, body, tone = 'warning', children,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body?: string;
  tone?: 'warning' | 'neutral';
  children?: React.ReactNode;
}) {
  const c = useColors();
  const esWarning = tone === 'warning';

  return (
    <View style={[
      styles.section,
      esWarning
        ? { backgroundColor: c.semantic.warningSoft, borderColor: c.semantic.warning }
        : { backgroundColor: c.bgGrouped, borderColor: c.hair },
    ]}>
      <Ionicons name={icon} size={18} color={esWarning ? c.semantic.warning : c.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={[Typography.bodyM, {
          color: esWarning ? c.semantic.warning : c.text, fontWeight: '600',
        }]}>
          {title}
        </Text>
        {body ? (
          <Text style={[Typography.bodyS, {
            color: esWarning ? c.semantic.warning : c.textSecondary,
            marginTop: 2, opacity: 0.9,
          }]}>
            {body}
          </Text>
        ) : null}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    marginBottom: Spacing[4],
    borderTopWidth: 1, borderBottomWidth: 1,
    paddingHorizontal: Spacing.screenPad, paddingVertical: Spacing[4],
  },
});
