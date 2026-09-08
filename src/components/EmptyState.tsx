import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface EmptyStateProps {
  iconName?: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  action?: React.ReactNode;
}

export function EmptyState({ iconName = 'people-outline', title, body, action }: EmptyStateProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={styles.container}>
      <View style={[styles.iconContainer, { backgroundColor: c.brand.primarySoft }]}>
        <Ionicons name={iconName} size={40} color={c.brand.primary} />
      </View>
      <View style={styles.text}>
        <Text style={[Typography.h3, { color: c.text, marginBottom: 6, textAlign: 'center' }]}>{title}</Text>
        <Text style={[Typography.bodyM, { color: c.textSecondary, textAlign: 'center', maxWidth: 280 }]}>{body}</Text>
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    /**
     * **Centrado vertical, no pegado abajo del título.**
     *
     * `flex: 1` acá sólo sirve si quien lo contiene le da el alto: adentro de un
     * `ScrollView` eso lo hace `contentContainerStyle: { flexGrow: 1 }`, que las
     * tres pantallas que lo usan declaran. Sin esa mitad, el `flex` no hace nada
     * y el cartel vuelve a quedar arriba — por eso van juntos y está escrito.
     */
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
    padding: Spacing[7],
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: Radius['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    alignItems: 'center',
  },
});
