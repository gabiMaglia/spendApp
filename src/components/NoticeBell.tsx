import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Colors } from '@/src/constants/colors';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Campanita con el contador de avisos sin leer.
 *
 * El número es el acuse de recibo LOCAL: cuántos avisos de este teléfono no se
 * miraron todavía. No viaja a ningún lado (decisión del PO).
 */
export function NoticeBell({ unread, onPress }: { unread: number; onPress: () => void }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { t } = useTranslation();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('notifications.inbox_open')}
      testID="notice-bell"
      onPress={onPress}
      hitSlop={8}
      style={styles.root}
    >
      <Ionicons
        name={unread > 0 ? 'notifications' : 'notifications-outline'}
        size={22}
        color={unread > 0 ? c.brand.primary : c.textSecondary}
      />
      {unread > 0 && (
        <View testID="notice-badge" style={[styles.badge, { backgroundColor: c.semantic.negative }]}>
          <Text style={[Typography.caption, styles.badgeText]}>
            {/* Más de 99 no aporta: el número se vuelve ilegible y da igual. */}
            {unread > 99 ? '99+' : unread}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Mismo footprint que el avatar y el selector de moneda (36) para que los
  // 3 controles del header queden del mismo tamaño visual (T-050).
  root:      { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute', top: 0, right: 0,
    minWidth: 16, height: 16, borderRadius: 8,
    paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 10, lineHeight: 14 },
});
