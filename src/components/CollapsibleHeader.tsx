import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/src/constants/colors';
import { Spacing } from '@/src/constants/spacing';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FondoMarmol } from '@/src/components/FondoMarmol';

/**
 * Header fijo común a todas las tabs.
 *
 * **T-114 (PO 2026-09-13):** dos filas — la de botones (avatar, campana,
 * moneda) arriba, y el bloque título (saludo opcional + título) abajo, con
 * `justifyContent: 'space-between'` entre las dos. El título YA NO scrollea
 * ni aparece recién al hacer scroll: antes vivía DUPLICADO —grande en el
 * contenido de cada pantalla, compacto y con fade-in en el header— y ahora es
 * el ÚNICO título, siempre visible. Lo que sigue colapsando con el scroll es
 * el VELO (T-110: `bgOpacity`/`hairOpacity`, 0 en reposo), no el texto.
 *
 * Si el proyecto agrega `expo-blur`, reemplazar el `Animated.View` de fondo por
 * `<BlurView intensity={...} tint={scheme}>`; los valores de opacidad de acá
 * están calculados para que el resultado sea equivalente sin blur.
 */
/** Alto de la fila de botones, sin el notch. */
export const HEADER_BAR_H = 52;

/**
 * Alto total del header (fila de botones + bloque título) que vio el PO en el teléfono
 * tras T-114: 52 + 33 = 85pt, sin el notch. Base del pedido de T-125.
 */
export const HEADER_TOTAL_H_T114 = 85;

/** «El doble y un poco más» (PO 2026-09-13, T-125): ×2,2 sobre el header de T-114. */
export const FACTOR_ALTO_HEADER = 2.2;

/**
 * **Alto del bloque título** (T-114 → T-125): lo que queda del alto total pedido después
 * de la fila de botones. La fila de botones no cambia; crece el espacio del título, que
 * va abajo con `space-between`. Es un piso: en Inicio el saludo suma una línea.
 */
/** Distancia máxima del título al borde inferior del header (PO, T-126). */
export const TITLE_BOTTOM_GAP = 6;

export const TITLE_BLOCK_H = Math.round(HEADER_TOTAL_H_T114 * FACTOR_ALTO_HEADER) - HEADER_BAR_H;

/**
 * Cuánto padding necesita el contenido para arrancar DEBAJO del header.
 *
 * Reemplaza a `Spacing.headerH`, que era un 96 fijo y **se quedaba corto en
 * cualquier teléfono con notch**: el header mide `insets.top + 52`, o sea entre
 * 99 y 111 en un iPhone moderno. El título grande de cada tab no estaba pegado
 * al header — estaba tapado por él.
 *
 * Un número fijo no puede resolver esto: el inset lo decide el aparato. Por eso
 * es un hook y no una constante. Desde T-114 suma también `TITLE_BLOCK_H`: el
 * título dejó de vivir en el contenido, así que el contenido tiene que bajar
 * lo que el header ahora ocupa de más.
 */
export function useHeaderPadding(aire: number = Spacing[4]): number {
  const insets = useSafeAreaInsets();
  return insets.top + HEADER_BAR_H + TITLE_BLOCK_H + aire;
}

export function CollapsibleHeader({
  title, subtitle, scrollY, right, left,
}: {
  title: string;
  /** Sólo Inicio lo pasa: "Hola, {nombre}" arriba del título (T-114). */
  subtitle?: string;
  scrollY: Animated.Value;
  right?: React.ReactNode;
  /** Avatar u otro botón de la fila de arriba. */
  left?: React.ReactNode;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();

  const bgOpacity = scrollY.interpolate({
    // En reposo el mármol se ve entero (PO 2026-09-13: en claro no se veía); al scrollear
    // vuelve el fondo para que el contenido que pasa por debajo no compita con el título.
    inputRange: [0, 60], outputRange: [0, 0.97], extrapolate: 'clamp',
  });
  const hairOpacity = scrollY.interpolate({
    inputRange: [0, 60], outputRange: [0, 1], extrapolate: 'clamp',
  });

  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]} pointerEvents="box-none">
      {/*
        T-105: el mármol va DEBAJO del tinte de fondo, no reemplazándolo. El
        tinte ya interpola su opacidad con el scroll (0.55 → 0.97) — es
        exactamente el fundido que evita el "corte feo" al colapsar: arriba
        se ve la veta, abajo el tinte casi opaco la tapa de a poco, nunca de
        golpe.
      */}
      <FondoMarmol />
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, opacity: bgOpacity }]}
        pointerEvents="none"
      />
      <Animated.View
        style={[styles.hair, { backgroundColor: c.hair, opacity: hairOpacity }]}
        pointerEvents="none"
      />
      <View style={styles.content}>
        <View style={styles.buttonsRow}>
          <View style={styles.buttonsLeft}>{left}</View>
          <View style={styles.right}>{right}</View>
        </View>
        <View style={styles.titleBlock} testID="header-title-block">
          {subtitle ? (
            <Text testID="header-subtitle" numberOfLines={1} style={[styles.subtitle, { color: c.textTertiary }]}>
              {subtitle}
            </Text>
          ) : null}
          <Text numberOfLines={1} style={[styles.title, { color: c.text }]}>
            {title}
          </Text>
        </View>
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
  // T-114: las dos filas del header, con el aire entre ellas resuelto por
  // `space-between` — no un gap fijo, para que el bloque título respete su
  // `minHeight` sin importar si tiene una línea (la mayoría) o dos (Inicio).
  content: {
    minHeight: HEADER_BAR_H + TITLE_BLOCK_H,
    justifyContent: 'space-between',
  },
  buttonsRow: {
    height: HEADER_BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad,
  },
  buttonsLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  // T-126 (PO): el título va ABAJO del header, a no más de 6pt del borde inferior.
  titleBlock: {
    minHeight: TITLE_BLOCK_H,
    justifyContent: 'flex-end',
    gap: 2,
    paddingHorizontal: Spacing.screenPad,
    paddingBottom: TITLE_BOTTOM_GAP,
  },
  subtitle: { fontSize: 12.5, fontWeight: '500' },
  title: { fontSize: 20, fontWeight: '800' },
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
    <View style={[detail.wrap, { paddingTop: insets.top, borderBottomColor: c.hair }]}>
      {/*
        T-105: `DetailHeader` es fijo (nunca colapsa), así que no tiene el
        fundido de `bgOpacity` de `CollapsibleHeader` para tapar el mármol
        progresivamente. Sin ESTE tinte encima, la veta quedaría a saturación
        completa detrás del título — por eso, a diferencia de la regla general
        de "sin overlays", acá sí hace falta uno (reportado en el handoff).
      */}
      <FondoMarmol />
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, opacity: 0.35 }]}
        pointerEvents="none"
      />
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
