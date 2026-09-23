import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing } from '@/src/constants/spacing';
import { hapticLight } from '@/src/utils/haptics';

/**
 * FAB del reskin: rectángulo redondeado (Radius.lg), no pill, sin escala al
 * tocar. Igual que antes NO se suma `useBottomTabBarHeight()`: la tab bar no
 * es absolute, así que `bottom: 0` ya es su borde superior.
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
 * ⚠️ **Fuera de las pestañas hay que sumar el inset del sistema.** `FabRow` es absoluto, y
 * un hijo absoluto se ubica contra el borde del contenedor, NO contra su padding: el
 * `SafeAreaView` de la pantalla no lo corre. En «Agregar contacto» el botón quedaba debajo
 * de la barra de tres botones de Android (2026-09-12). Dentro de las pestañas no pasa: la
 * tab bar ya ocupa esa franja, y sumarlo lo dejaría flotando de más.
 */
export function separacionInferiorDelFab(
  { dentroDePestanas, insetInferior }: { dentroDePestanas: boolean; insetInferior: number },
): number {
  return FAB_BOTTOM_GAP + (dentroDePestanas ? 0 : insetInferior);
}

/** Posiciona uno o más `<Fab>` abajo: sobre la tab bar, o sobre la barra del sistema. */
export function FabRow({ children }: { children: React.ReactNode }) {
  // La tab bar publica su alto en este contexto; afuera de las pestañas es `undefined`.
  const dentroDePestanas = React.useContext(BottomTabBarHeightContext) !== undefined;
  const insets = useSafeAreaInsets();
  const bottom = separacionInferiorDelFab({ dentroDePestanas, insetInferior: insets.bottom });
  return (
    <View pointerEvents="box-none" style={[styles.row, { bottom }]}>
      {children}
    </View>
  );
}

type FabVariant = 'primary' | 'secondary';

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
}: FabProps) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      testID={testID}
      onPress={() => { hapticLight(); onPress(); }}
      style={({ pressed }) => [
        styles.fab,
        isPrimary ? styles.fabPrimary : styles.fabSecondary,
        { backgroundColor },
        borderColor ? { borderWidth: 1, borderColor } : null,
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
