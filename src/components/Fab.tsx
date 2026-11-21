import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';

import { Radius, Spacing } from '@/src/constants/spacing';
import { hapticLight } from '@/src/utils/haptics';
import { useBaseInferior } from '@/src/hooks/useBaseInferior';
import { useRellenoBarraPestanas } from '@/src/hooks/useRellenoBarraPestanas';
import { useColors } from '@/src/skins/useSkin';

/**
 * FAB del reskin: rectángulo redondeado (Radius.lg), no pill, sin escala al
 * tocar. En Clásico la tab bar no es absolute, así que `bottom: 0` ya es su
 * borde superior; en Aero flota (T-227) y `FabRow` suma su alto.
 */
/** Separación del FAB al borde inferior dentro de las pestañas, y alto de cada
 * botón (`styles.fab.height`) — expuestos para que una pantalla con lista corta
 * pueda reservar ese espacio en su `paddingBottom` y no dejar que el FAB tape
 * la última fila (PO 2026-09-22: pasaba en Personal con pocos movimientos). */
export const FAB_BOTTOM_GAP = Spacing[4];
export const FAB_HEIGHT = 48;

/**
 * Cuánto separar el FAB del borde inferior de la pantalla.
 *
 * Fuera de las pestañas es la base de la píldora (T-281), que ya cuenta el inset del sistema.
 * ⚠️ **Hay que usarla en vez de confiar en el SafeAreaView.** `FabRow` es absoluto, y
 * un hijo absoluto se ubica contra el borde del contenedor, NO contra su padding: el
 * `SafeAreaView` de la pantalla no lo corre. En «Agregar contacto» el botón quedaba debajo
 * de la barra de tres botones de Android (2026-09-12). Dentro de las pestañas no pasa: la
 * tab bar ya ocupa esa franja, y sumarlo lo dejaría flotando de más.
 */
export function separacionInferiorDelFab(
  { dentroDePestanas, baseInferior, barraFlotante = 0 }: {
    dentroDePestanas: boolean;
    /** Base de la píldora (`useBaseInferior`): ya incluye el inset del sistema. */
    baseInferior: number;
    /** Alto de la barra de pestañas cuando flota sobre el contenido (Aero). */
    barraFlotante?: number;
  },
): number {
  return dentroDePestanas ? FAB_BOTTOM_GAP + barraFlotante : baseInferior;
}

/** Posiciona uno o más `<Fab>` abajo: sobre la tab bar, o sobre la barra del sistema. */
export function FabRow({ children }: { children: React.ReactNode }) {
  // La tab bar publica su alto en este contexto; afuera de las pestañas es `undefined`.
  const dentroDePestanas = React.useContext(BottomTabBarHeightContext) !== undefined;
  const base = useBaseInferior();
  const barraFlotante = useRellenoBarraPestanas();
  const bottom = separacionInferiorDelFab({ dentroDePestanas, baseInferior: base, barraFlotante });
  return (
    <View testID="fab-row" pointerEvents="box-none" style={[styles.row, { bottom }]}>
      {children}
    </View>
  );
}

type FabVariant = 'primary' | 'secondary';

/** `rgba(…, a)` con a < 1, o `transparent`. */
function esTranslucido(color: string): boolean {
  const c = color.trim().toLowerCase();
  if (c === 'transparent') return true;
  const m = /^rgba\(.*,\s*([\d.]+)\s*\)$/.exec(c);
  return m ? Number(m[1]) < 1 : false;
}

/**
 * Fondo del FAB. Flota sobre contenido que scrollea, así que un color
 * translúcido (en oscuro `brand.primarySoft` es un rgba al 14 %) dejaba leer lo
 * de abajo a través del botón: se pinta sobre la base opaca `base`.
 */
export function fondoDelFab(color: string, base: string): ViewStyle {
  if (!esTranslucido(color)) return { backgroundColor: color };
  if (color.trim().toLowerCase() === 'transparent') return { backgroundColor: base };
  return { backgroundColor: base, experimental_backgroundImage: `linear-gradient(${color}, ${color})` };
}

interface FabProps {
  onPress: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
  variant?: FabVariant;
  backgroundColor: string;
  borderColor?: string;
  iconColor?: string;
  textColor?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function Fab({
  onPress,
  icon,
  label,
  variant = 'primary',
  backgroundColor,
  borderColor,
  iconColor = '#fff',
  textColor = '#fff',
  testID,
  style,
}: FabProps) {
  const isPrimary = variant === 'primary';
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      onPress={() => { hapticLight(); onPress(); }}
      style={({ pressed }) => [
        styles.fab,
        isPrimary ? styles.fabPrimary : styles.fabSecondary,
        fondoDelFab(backgroundColor, c.surfaceRaised),
        borderColor ? { borderWidth: 1, borderColor } : null,
        style,
        pressed && { opacity: 0.9 },
      ]}
    >
      <Ionicons name={icon} size={17} color={iconColor} />
      {label ? (
        <Text style={{ color: textColor, fontSize: 14.5, fontWeight: '700' }}>{label}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    right: Spacing.screenPad,
    left: Spacing.screenPad,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 9,
  },
  fab: {
    height: 48,
    paddingHorizontal: 18,
    borderRadius: Radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // Sombra sólo en el primario: es la única superficie elevada del tema.
  fabPrimary:   { boxShadow: '0 6px 16px rgba(20,60,40,0.22)' },
  fabSecondary: {},
});
