import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/src/constants/colors';
import { Spacing } from '@/src/constants/spacing';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Header fijo común a todas las tabs.
 *
 * Colapsa con el scroll: gana opacidad, hairline y el título compacto aparece
 * cuando el título grande de la pantalla ya salió de pantalla. El título grande
 * NO vive acá — vive en el contenido y scrollea.
 *
 * Si el proyecto agrega `expo-blur`, reemplazar el `Animated.View` de fondo por
 * `<BlurView intensity={...} tint={scheme}>`; los valores de opacidad de acá
 * están calculados para que el resultado sea equivalente sin blur.
 */
/** Alto de la barra, sin el notch. El header real mide esto + `insets.top`. */
export const HEADER_BAR_H = 52;

/**
 * Cuánto padding necesita el contenido para arrancar DEBAJO del header.
 *
 * Reemplaza a `Spacing.headerH`, que era un 96 fijo y **se quedaba corto en
 * cualquier teléfono con notch**: el header mide `insets.top + 52`, o sea entre
 * 99 y 111 en un iPhone moderno. El título grande de cada tab no estaba pegado
 * al header — estaba tapado por él.
 *
 * Un número fijo no puede resolver esto: el inset lo decide el aparato. Por eso
 * es un hook y no una constante.
 */
export function useHeaderPadding(aire = Spacing[4]): number {
  const insets = useSafeAreaInsets();
  return insets.top + HEADER_BAR_H + aire;
}

export function CollapsibleHeader({
  title, scrollY, right, left,
}: {
  title: string;
  scrollY: Animated.Value;
  right?: React.ReactNode;
  /** Avatar o botón a la izquierda del título compacto. */
  left?: React.ReactNode;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();

  const bgOpacity = scrollY.interpolate({
    inputRange: [0, 60], outputRange: [0.55, 0.97], extrapolate: 'clamp',
  });
  const hairOpacity = scrollY.interpolate({
    inputRange: [0, 60], outputRange: [0, 1], extrapolate: 'clamp',
  });
  const titleOpacity = scrollY.interpolate({
    inputRange: [26, 70], outputRange: [0, 1], extrapolate: 'clamp',
  });
  const titleShift = scrollY.interpolate({
    inputRange: [26, 70], outputRange: [8, 0], extrapolate: 'clamp',
  });

  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]} pointerEvents="box-none">
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, opacity: bgOpacity }]}
        pointerEvents="none"
      />
      <Animated.View
        style={[styles.hair, { backgroundColor: c.hair, opacity: hairOpacity }]}
        pointerEvents="none"
      />
      <View style={styles.bar}>
        <View style={styles.left}>
          {left}
          <Animated.Text
            numberOfLines={1}
            style={[
              styles.title,
              { color: c.text, opacity: titleOpacity, transform: [{ translateY: titleShift }] },
            ]}
          >
            {title}
          </Animated.Text>
        </View>
        <View style={styles.right}>{right}</View>
      </View>
    </View>
  );
}

/** Avatar de iniciales del header. */
export function HeaderAvatar({ initials }: { initials: string }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <View style={[styles.avatar, { backgroundColor: c.text }]}>
      <Text style={{ fontSize: 11, fontWeight: '600', color: c.bg }}>{initials}</Text>
    </View>
  );
}

/** Chip de moneda del header. */
export function HeaderCurrency({ code, onPress }: { code: string; onPress?: () => void }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 0.5, color: c.textSecondary }}>
        {code}
      </Text>
    </Pressable>
  );
}

/** Botón de ícono del header (34pt, sin fondo). */
export function HeaderIcon({
  name, onPress,
}: { name: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <Pressable onPress={onPress} hitSlop={10} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
      <Ionicons name={name} size={19} color={c.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  hair: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1 },
  bar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad,
  },
  left:  { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  title: { fontSize: 16, fontWeight: '700' },
  avatar: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
});

/**
 * Header de pantalla de detalle (grupo, gasto, saldar): back + título + acción.
 * Fijo, con hairline permanente — acá no hay título grande que colapsar.
 */
export function DetailHeader({
  title, onBack, right, icon = 'arrow-back',
}: {
  title: string;
  onBack: () => void;
  right?: React.ReactNode;
  /** `close` en pantallas de formulario que se cierran, no que vuelven. */
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  return (
    <View style={[detail.wrap, {
      paddingTop: insets.top, backgroundColor: c.bg, borderBottomColor: c.hair,
    }]}>
      <View style={detail.bar}>
        <Pressable onPress={onBack} hitSlop={12} style={detail.side}>
          <Ionicons name={icon} size={22} color={c.text} />
        </Pressable>
        <Text numberOfLines={1} style={[detail.title, { color: c.text }]}>{title}</Text>
        <View style={[detail.side, { alignItems: 'flex-end' }]}>{right}</View>
      </View>
    </View>
  );
}

const detail = StyleSheet.create({
  wrap: { borderBottomWidth: 1 },
  bar: {
    height: 52, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.screenPad, gap: 12,
  },
  // 56, no 32: la acción derecha suele ser una palabra ("Crear", "Guardar").
  side:  { width: 56, justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
});
