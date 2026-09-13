import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { HapticTab } from '@/components/haptic-tab';
import { Colors } from '@/src/constants/colors';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Tab bar del reskin: 70 de contenido + el inset inferior del sistema, hairline superior, ícono 20, label 9.5/600 y
 * PUNTO activo de 4pt debajo del label (reemplaza la pastilla y el ícono
 * relleno). El label se rinde a mano para poder colgarle el punto.
 */
/**
 * Alto del contenido de la barra, sin contar lo que ocupa el sistema abajo.
 *
 * Es lo que la pestaña APILA, medido y no elegido: borde 1 + `paddingTop` 11 + padding
 * del ítem 5 + ícono ≈26 + texto ≈13 + separación 5 + punto 4 + padding 5 ≈ **70**.
 * Con el `88` fijo de antes quedaban 54 en iPhone (88 − 34) y el punto se salía por
 * abajo: en iOS no se notaba porque la zona del indicador es transparente, pero en
 * Android esa franja tiene el velo de la barra de tres botones y lo tapaba.
 */
const ALTO_CONTENIDO = 70;
/** Aire mínimo abajo en aparatos sin inset (iPhone SE, Android sin barra de navegación). */
const PISO_INFERIOR = 12;

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
  const insets = useSafeAreaInsets();

  /**
   * ⚠️ **El alto NO puede ser un número fijo.** React Navigation calcula el alto de la barra
   * sumando `insets.bottom`, y un `height` en `tabBarStyle` pisa ese cálculo. Era `88`:
   * en iPhone daba justo (54 + 34 del indicador de inicio), pero **en Android con
   * edge-to-edge la barra de tres botones (≈48dp) tapaba los íconos**. Se suma el inset
   * real, y `paddingBottom` va con el mismo valor para que el contenido quede encima.
   */
  const inferior = Math.max(insets.bottom, PISO_INFERIOR);

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
          height: ALTO_CONTENIDO + inferior,
          paddingTop: 11,
          paddingBottom: inferior,
          backgroundColor: c.bg,
          borderTopWidth: 1,
          borderTopColor: c.hair,
          elevation: 0,
        },
        tabBarItemStyle: { paddingTop: 0 },
        tabBarIconStyle: { marginBottom: -2 },
      }}
    >
      {screen('index',     t('tabs.home'),     'home-outline')}
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
