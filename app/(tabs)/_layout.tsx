import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { HapticTab } from '@/components/haptic-tab';
import { useSkin, useColors } from '@/src/skins/useSkin';
import { TabBarFondoAero } from '@/src/components/skin/TabBarFondoAero';
import { TabBarFondoClasico } from '@/src/components/skin/TabBarFondoClasico';
import { medidasBarraPestanas } from '@/src/components/skin/medidasBarraPestanas';

/** Tab bar: píldora flotante tipo iOS 26 (T-276); medidas en `medidasBarraPestanas`. Ícono 20, label 10/600 y punto activo (sólo Clásico). */
function TabLabel({ label, focused }: { label: string; focused: boolean }) {
  const c = useColors();
  const { skin } = useSkin();
  const color = focused ? c.brand.primary : c.textTertiary;
  // Aero (T-227 punto 10, y revertida la píldora el mismo día): sin indicador
  // debajo del label — la elegida se distingue sólo por el color de ícono y
  // label. Con el skin default, el punto de siempre.
  const soft = skin.flags.soft;
  return (
    <View style={styles.labelWrap}>
      <Text numberOfLines={1} style={[styles.label, { color }]}>{label}</Text>
      {soft ? null : (
        <View testID="tab-indicador" style={[styles.dot, { backgroundColor: focused ? c.brand.primary : 'transparent' }]} />
      )}
    </View>
  );
}

export default function TabLayout() {
  const c = useColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const { skin } = useSkin();
  const soft = skin.flags.soft;
  // Clásico tiene inset 0: se usa el margen del Aero para que sean iguales.
  const medidas = medidasBarraPestanas({
    insetBottom: insets.bottom,
    plataforma: Platform.OS === 'ios' ? 'ios' : 'android',
    margenLateral: Math.max(skin.space.inset, 16),
  });

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
        // T-202: pausa el re-render de las tabs que NO se ven (requiere
        // `enableFreeze(true)` en `app/_layout.tsx`) — ver el comentario ahí.
        freezeOnBlur: true,
        tabBarButton: HapticTab,
        tabBarActiveTintColor:   c.brand.primary,
        tabBarInactiveTintColor: c.textTertiary,
        // El alto NO es fijo: es la huella de la píldora (alto + distancia al borde).
        // Flota sobre el contenido; cada pestaña reserva su alto con `useRellenoBarraPestanas`.
        tabBarStyle: {
          position: 'absolute', left: 0, right: 0, bottom: 0,
          height: medidas.huella,
          paddingTop: 6,
          paddingBottom: medidas.bottom,
          paddingHorizontal: medidas.margenLateral,
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
        },
        tabBarBackground: () => soft
          ? <TabBarFondoAero bottom={medidas.bottom} alto={medidas.altoPildora} margen={medidas.margenLateral} />
          : <TabBarFondoClasico bottom={medidas.bottom} alto={medidas.altoPildora} margen={medidas.margenLateral} />,
        tabBarItemStyle: { paddingTop: 0 },
        tabBarIconStyle: { marginBottom: -2 },
      }}
    >
      {screen('index',     t('tabs.personal'), 'analytics-outline')}
      {/* Orden del PO (2026-09-29): Personal, Grupos, Amigos, Actividad. */}
      {screen('groups',    t('tabs.groups'),   'grid-outline')}
      {screen('friends',   t('tabs.friends'),  'people-outline')}
      {screen('activity',  t('tabs.activity'), 'pulse-outline')}
      {/*
        T-115 (PO 2026-09-13): "Yo" sale del tab bar — a esa pantalla se llega
        tocando el avatar del header. `href: null` es el mecanismo de
        expo-router@6 para ocultar el botón SIN borrar la ruta (verificado en
        `node_modules/expo-router/build/layouts/TabsClient.js:16-28`: setea
        `tabBarItemStyle:{display:'none'}` y anula `tabBarButton`, pero deja
        el `Screen` — y con él la ruta `/(tabs)/user` — intacto). Borrar el
        `<Tabs.Screen>` entero rompería `router.push('/(tabs)/user')` desde
        `TabHeader` y cualquier deep link a Perfil.
      */}
      <Tabs.Screen name="user" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  labelWrap: { alignItems: 'center', gap: 5 },
  label: { fontSize: 10, fontWeight: '600' },
  dot: { width: 4, height: 4, borderRadius: 2 },
});
