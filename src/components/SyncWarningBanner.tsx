import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Avisa que este grupo dejó de sincronizar.
 *
 * Mismo principio que `UnconvertedNotice`: la app no puede verse perfecta
 * mientras esconde que algo dejó de funcionar. Un grupo que no publica es
 * indistinguible de uno sano —los gastos se cargan, los balances se calculan,
 * todo local anda— y el usuario se entera semanas después, cuando alguien le
 * dice que no ve nada.
 *
 * Recibe el texto YA traducido: el componente dibuja, no resuelve idioma.
 */
export function SyncWarningBanner({ title, body }: { title: string; body: string }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View
      accessibilityRole="alert"
      style={[styles.wrap, { backgroundColor: c.semantic.warningSoft, borderColor: c.semantic.warning }]}
    >
      <Ionicons name="cloud-offline-outline" size={20} color={c.semantic.error} />
      <View style={styles.texts}>
        <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]}>{title}</Text>
        <Text style={[Typography.bodyS, { color: c.textSecondary }]}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[2],
    padding: Spacing[4],
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  texts: { flex: 1, gap: 2 },
});
