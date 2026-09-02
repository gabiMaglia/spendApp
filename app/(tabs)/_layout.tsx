import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { HapticTab } from '@/components/haptic-tab';
import { Colors } from '@/src/constants/colors';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Tab bar del reskin: alto 88, hairline superior, ícono 20, label 9.5/600 y
 * PUNTO activo de 4pt debajo del label (reemplaza la pastilla y el ícono
 * relleno). El label se rinde a mano para poder colgarle el punto.
 */
function TabLabel({ label, focused }: { label: string; focused: boolean }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const color = focused ? c.brand.primary : c.textTertiary;
  return (
    <View style={styles.labelWrap}>
      <Text numberOfLines={1} style={[styles.label, { color }]}>{label}</Text>
      <View style={[styles.dot, { backgroundColor: focused ? c.brand.primary : 'transparent' }]} />
    </View>
  );
}

export default function TabLayout() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { t } = useTranslation();

  const screen = (
    name: string,
    title: string,
    icon: keyof typeof Ionicons.glyphMap,
  ) => (
    <Tabs.Screen
      key={name}
      name={name}
      options={{
        title,
        tabBarIcon: ({ color }) => <Ionicons name={icon} size={20} color={color} />,
        tabBarLabel: ({ focused }) => <TabLabel label={title} focused={focused} />,
      }}
    />
  );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarActiveTintColor:   c.brand.primary,
        tabBarInactiveTintColor: c.textTertiary,
        tabBarStyle: {
          height: 88,
          paddingTop: 11,
          backgroundColor: c.bg,
          borderTopWidth: 1,
          borderTopColor: c.hair,
          elevation: 0,
        },
        tabBarItemStyle: { paddingTop: 0 },
        tabBarIconStyle: { marginBottom: -2 },
      }}
    >
      {screen('index',     t('tabs.account'),  'wallet-outline')}
      {screen('personal',  t('tabs.personal'), 'analytics-outline')}
      {screen('friends',   t('tabs.friends'),  'people-outline')}
      {screen('groups',    t('tabs.groups'),   'grid-outline')}
      {screen('activity',  t('tabs.activity'), 'pulse-outline')}
      {screen('user',      t('tabs.me'),       'person-outline')}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  labelWrap: { alignItems: 'center', gap: 5 },
  label: { fontSize: 9.5, fontWeight: '600' },
  dot: { width: 4, height: 4, borderRadius: 2 },
});
