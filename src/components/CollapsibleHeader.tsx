import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, type SharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/src/constants/spacing';
import { FondoMarmol } from '@/src/components/FondoMarmol';
import { useSkinTokens, useColors } from '@/src/skins/useSkin';
import { HeaderAero, fondoBarraAero } from '@/src/components/skin/HeaderAero';
import { RECORRIDO_AERO } from '@/src/components/skin/headerAeroGeometria';
import { DETAIL_BAR_H, DetailHeaderAero } from '@/src/components/skin/DetailHeaderAero';
import { HEADER_BAR_H, TITLE_BOTTOM_GAP, TITLE_BLOCK_H } from '@/src/constants/header';
import {
  desplazamientoHeader, opacidadTituloCompacto, opacidadTituloCompactoSinMovimiento,
  opacidadTituloGrande, opacidadTituloGrandeSinMovimiento,
} from '@/src/hooks/useHeaderColapsable';

/**
 * Header fijo común a todas las tabs.
 *
 * **T-114 (PO 2026-09-13):** dos filas — la de botones (avatar, campana,
 * moneda) arriba, y el bloque título (saludo opcional + título) abajo, con
 * `justifyContent: 'space-between'` entre las dos.
 *
 * **T-128 (PO 2026-09-13, probando en el teléfono): el header colapsa al
 * scrollear, y el mármol NUNCA desaparece — es invariante.** Se saca el velo
 * de T-105/T-110 (`bgOpacity`/`hairOpacity` tapando la textura hasta 0.97 de
 * opacidad): la textura es un JPEG opaco y alcanza sola para que el
 * contenido que scrollea por debajo no se vea. Lo que colapsa ahora es el
 * ALTO del header (`alturaHeaderColapsable`, de `insets.top + HEADER_BAR_H +
 * TITLE_BLOCK_H` a `insets.top + HEADER_BAR_H`), con `overflow: 'hidden'`:
 * el mármol se dimensiona al alto EXPANDIDO (+ margen extra, por si algún
 * frame de overscroll pidiera más alto que el expandido) y ancla arriba, así
 * nunca se estira ni deforma — sólo se ve menos textura, nunca menos opaca.
 *
 * El bloque título grande (y el saludo de Inicio) se recorta bajo la barra a
 * medida que el header colapsa. El título CHICO junto a la foto de perfil
 * tiene fade propio, sincronizado con el progreso.
 *
 * **T-220 (PO 2026-09-29, Moto E40):** el colapso ya no anima el ALTO: el
 * fondo mide siempre el expandido y SUBE por traslado (mismo borde de abajo,
 * `desplazamientoHeader`), el mármol se compensa para quedar quieto, y el
 * bloque título sube dentro de una ventana fija bajo la barra. Animar
 * `height` recalculaba el layout del header en cada frame de scroll.
 */
// Medidas del header en `src/constants/header.ts`: así el hook de colapso no importa este
// componente y no se arma un ciclo de require (T-128). Se re-exportan por compatibilidad.
export { RellenoDetailHeader, useRellenoDetailHeader } from '@/src/components/skin/DetailHeaderAero';
export {
  HEADER_BAR_H, HEADER_TOTAL_H_T114, FACTOR_ALTO_HEADER, TITLE_BOTTOM_GAP, TITLE_BLOCK_H,
} from '@/src/constants/header';

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
  // T-131: el scroll ya arranca debajo de la barra fija (`useLimiteContenido`), así que el
  // padding sólo cubre el bloque título que se colapsa.
  const soft = useSkinTokens().flags.soft;
  const insets = useSafeAreaInsets();
  // Aero (PO 2026-09-26, header transparente): el scroll arranca en el borde
  // de arriba de la pantalla (ver `useLimiteContenido`), así que el padding
  // cubre también la status bar y la barra.
  return soft ? fondoBarraAero(insets.top) + RECORRIDO_AERO + aire : TITLE_BLOCK_H + aire;
}

/**
 * **Límite fijo del contenido** (T-131, PO): el `ScrollView` de cada pestaña arranca debajo de
 * la fila de botones (el alto colapsado del header). Así ningún elemento puede quedar dibujado
 * adentro de la barra: lo que sube más allá se recorta en ese borde.
 */
export function useLimiteContenido(): { marginTop: number } {
  const insets = useSafeAreaInsets();
  // Skin Aero (PO 2026-09-26, header transparente): sin límite. El contenido
  // sube por DETRÁS de las tarjetas del header (que lo tapan solo donde
  // están) y se sigue viendo en los huecos hasta el borde de la pantalla.
  // Con el default, el límite de siempre.
  const soft = useSkinTokens().flags.soft;
  return { marginTop: soft ? 0 : insets.top + HEADER_BAR_H };
}

/** Margen extra, en pt, del mármol más allá del alto expandido — colchón de seguridad para que nunca se vea un hueco. */
export const MARMOL_BLEED = 80;

export function CollapsibleHeader({
  title, subtitle, progress, right, left,
}: {
  title: string;
  /** Sólo Inicio lo pasa: "Hola, {nombre}" arriba del título (T-114). */
  subtitle?: string;
  /** Progreso de colapso en [0,1] — de `useHeaderColapsable` (T-128). */
  progress: SharedValue<number>;
  right?: React.ReactNode;
  /** Avatar u otro botón de la fila de arriba. */
  left?: React.ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const soft = useSkinTokens().flags.soft;

  const expandido = insets.top + HEADER_BAR_H + TITLE_BLOCK_H;
  const colapsado = insets.top + HEADER_BAR_H;

  // Memoizado (PO 2026-09-22, rendimiento en gama baja): sin esto era un
  // literal nuevo en cada render de este header, así que el `React.memo` de
  // `FondoMarmol` nunca frenaba nada acá — su prop `style` "cambiaba"
  // siempre, aunque el valor fuera idéntico. `expandido` casi no cambia
  // (depende del inset del sistema), así que esta referencia queda estable.
  const marmolStyle = useMemo(
    () => ({ top: 0, bottom: undefined, height: expandido + MARMOL_BLEED }),
    [expandido],
  );

  // «Reducir movimiento»: sin fades en los títulos (T-128).
  const reducirMovimiento = useReducedMotion();

  // T-220: nada de lo que anima el scroll toca el layout. Antes se animaba
  // `height` del header y de la ventana del título, y Fabric recalculaba el
  // layout de todo el subárbol en cada frame (el jank medido en T-216). Ahora
  // el fondo tiene alto fijo (expandido) y SUBE; su borde de abajo queda
  // exactamente donde quedaba el del header que se achicaba.
  const fondoStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -desplazamientoHeader(progress.value, expandido, colapsado) }],
  }));

  // El mármol baja lo mismo que sube el fondo: la textura queda quieta en
  // pantalla y sólo se ve menos por abajo (invariante T-128, igual que antes).
  const marmolAnclaStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: desplazamientoHeader(progress.value, expandido, colapsado) }],
  }));

  // El bloque título sube con el borde de abajo del header y se recorta en la
  // ventana FIJA de debajo de la barra (antes la ventana se achicaba).
  const tituloMovilStyle = useAnimatedStyle(() => ({
    opacity: reducirMovimiento
      ? opacidadTituloGrandeSinMovimiento(progress.value)
      : opacidadTituloGrande(progress.value),
    transform: [{ translateY: -desplazamientoHeader(progress.value, expandido, colapsado) }],
  }));

  const tituloCompactoStyle = useAnimatedStyle(() => ({
    opacity: reducirMovimiento
      ? opacidadTituloCompactoSinMovimiento(progress.value)
      : opacidadTituloCompacto(progress.value),
  }));

  // Skin Aero: header propio (dos tarjetas que se funden). Va después de
  // todos los hooks de arriba; con el skin default este return no ocurre y el
  // header es exactamente el de siempre.
  if (soft) {
    return <HeaderAero title={title} subtitle={subtitle} progress={progress} right={right} left={left} />;
  }

  return (
    <View style={[styles.capa, { height: expandido }]} pointerEvents="box-none">
      {/*
        Fondo (T-220): alto FIJO expandido, sube por traslado. Con
        `overflow: hidden` recorta el mármol por abajo a medida que sube.
        T-128 (invariante del PO): el mármol mide el alto EXPANDIDO (+
        `MARMOL_BLEED`), está anclado arriba en pantalla y nunca se estira ni
        pierde opacidad — sólo se ve menos textura.
      */}
      <Animated.View testID="header-wrap" style={[styles.wrap, { height: expandido }, fondoStyle]}>
        <Animated.View
          testID="header-marmol-ancla"
          style={[StyleSheet.absoluteFill, marmolAnclaStyle]}
          pointerEvents="none"
        >
          <FondoMarmol style={marmolStyle} />
        </Animated.View>
        <View style={[styles.hair, { backgroundColor: c.hair }]} pointerEvents="none" />
      </Animated.View>

      {/* Ventana fija del bloque título, justo debajo de la barra: lo que sube por encima se corta acá. */}
      <View
        testID="header-title-block-clip"
        style={[styles.titleClip, { top: colapsado, height: TITLE_BLOCK_H }]}
        pointerEvents="none"
      >
        <Animated.View testID="header-title-block-movil" style={tituloMovilStyle}>
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
        </Animated.View>
      </View>

      {/* Fila de botones: fija, nunca se mueve (queda arriba del fondo que sube). */}
      <View style={[styles.buttonsRow, { top: insets.top }]} pointerEvents="box-none">
        <View style={styles.buttonsLeft}>
          {left}
          {/* Duplica el título grande: oculto al lector de pantalla para no anunciarlo dos veces (T-128). */}
          <Animated.Text
            testID="header-title-compact"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            numberOfLines={1}
            style={[styles.titleCompact, tituloCompactoStyle, { color: c.text }]}
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
  const c = useColors();
  return (
    <View style={[styles.avatar, { backgroundColor: c.text }]}>
      <Text style={{ fontSize: 11, fontWeight: '600', color: c.bg }}>{initials}</Text>
    </View>
  );
}

/** Chip de moneda del header. */
export function HeaderCurrency({ code, onPress }: { code: string; onPress?: () => void }) {
  const c = useColors();
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
  const c = useColors();
  return (
    <Pressable onPress={onPress} hitSlop={10} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
      <Ionicons name={name} size={19} color={c.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // T-220: contenedor quieto del header entero (alto expandido); no recibe
  // toques, sólo sus hijos — igual que el `wrap` de antes.
  capa: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  // Fondo del header: alto fijo expandido, sube por traslado. `overflow:
  // hidden` recorta el mármol por abajo a medida que sube (T-128).
  wrap: {
    position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden',
  },
  hair: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1 },
  buttonsRow: {
    position: 'absolute', left: 0, right: 0,
    height: HEADER_BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad,
  },
  buttonsLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  // Ventana FIJA del bloque título (T-220), justo debajo de la barra: el
  // bloque (alto TITLE_BLOCK_H, pegado abajo) sube por traslado y lo que pasa
  // por encima de la barra se corta acá — el saludo primero (T-128) y el
  // título grande al final del recorrido.
  titleClip: {
    position: 'absolute', left: 0, right: 0,
    overflow: 'hidden',
  },
  // T-126 (PO): el título va ABAJO del header, a no más de 6pt del borde inferior.
  titleBlock: {
    height: TITLE_BLOCK_H,
    justifyContent: 'flex-end',
    gap: 2,
    paddingHorizontal: Spacing.screenPad,
    paddingBottom: TITLE_BOTTOM_GAP,
  },
  subtitle: { fontSize: 12.5, fontWeight: '500' },
  title: { fontSize: 20, fontWeight: '800' },
  // T-128: título chico junto a la foto de perfil, visible sólo colapsado.
  titleCompact: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
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
  const c = useColors();
  const insets = useSafeAreaInsets();
  const skin = useSkinTokens();

  const barra = (
    <View style={[detail.bar, skin.flags.soft && detail.barAero]}>
      <Pressable onPress={onBack} hitSlop={12} style={detail.side}>
        <Ionicons name={icon} size={22} color={c.text} />
      </Pressable>
      <Text numberOfLines={1} style={[detail.title, { color: c.text }]}>{title}</Text>
      <View style={[detail.side, { alignItems: 'flex-end' }]}>{right}</View>
    </View>
  );

  // Aero: la tarjeta flota sobre el contenido, con velo (T-227 punto 5).
  if (skin.flags.soft) return <DetailHeaderAero>{barra}</DetailHeaderAero>;

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
      {barra}
    </View>
  );
}

const detail = StyleSheet.create({
  wrap: { borderBottomWidth: 1 },
  barAero: { paddingHorizontal: Spacing.screenPad - 8 },
  bar: {
    height: DETAIL_BAR_H, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.screenPad, gap: 12,
  },
  // 56, no 32: la acción derecha suele ser una palabra ("Crear", "Guardar").
  side:  { width: 56, justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
});
